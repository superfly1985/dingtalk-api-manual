// 钉钉权限探测脚本：只发最小请求，验证各类接口是否可访问，不做全量拉取
const fs = require('fs');

const env = fs.readFileSync(process.env.USERPROFILE + '/.dingtalk/.env', 'utf8');
const get = (k) => {
  const m = new RegExp(k + '=(.*)').exec(env);
  return m ? m[1].trim() : '';
};
const appKey = get('DINGTALK_CLIENT_ID');
const appSecret = get('DINGTALK_CLIENT_SECRET');

const OAPI = 'https://oapi.dingtalk.com';
const API = 'https://api.dingtalk.com';

const summary = [];
const note = (name, ok, detail) => {
  summary.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}: ${detail}`);
};

async function main() {
  // 0. 获取 access_token
  let r = await (await fetch(`${API}/v1.0/oauth2/accessToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appKey, appSecret }),
  })).json();
  if (!r.accessToken) {
    console.log('❌ access_token 获取失败:', JSON.stringify(r));
    return;
  }
  console.log(`✅ access_token 获取成功 (有效期 ${r.expireIn}s)\n`);
  const token = r.accessToken;
  const hdr = { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': token };
  const post = async (url, body, h = hdr) =>
    (await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body || {}) })).json();
  const isOk = (x) => x && x.errcode === 0;

  // 1. 通讯录：根部门下的子部门
  r = await post(`${OAPI}/topapi/v2/department/listsub?access_token=${token}`, { dept_id: 1 });
  const depts = isOk(r) ? r.result : [];
  note('通讯录·部门列表', isOk(r),
    isOk(r) ? `根部门下 ${depts.length} 个子部门，示例: ${depts.slice(0, 3).map(d => `${d.name}(${d.dept_id})`).join(', ')}` : JSON.stringify(r));

  // 2. 通讯录：部门用户（只取 1 条）
  const deptId = depts.length ? depts[0].dept_id : 1;
  r = await post(`${OAPI}/topapi/v2/user/list?access_token=${token}`, { dept_id: deptId, cursor: 0, size: 1 });
  const users = isOk(r) ? r.result.list : [];
  note('通讯录·部门用户', isOk(r),
    isOk(r) ? `部门 ${deptId} 共 ${r.result.total} 人（本次仅取 ${users.length} 条），示例: ${users.map(u => u.name + '(' + u.userid + ')').join(', ')}` : JSON.stringify(r));

  // 3. 通讯录：用户详情（只取第 1 个用户的字段可用性）
  if (users.length) {
    r = await post(`${OAPI}/topapi/v2/user/get?access_token=${token}`, { userid: users[0].userid });
    if (isOk(r)) {
      const fields = ['name', 'mobile', 'email', 'unionid', 'title', 'dept_id_list', 'job_number', 'active', 'avatar'];
      const present = fields.filter(f => r.result[f] !== undefined && r.result[f] !== null);
      note('通讯录·用户详情', true, `可读字段: ${present.join(', ')}`);
    } else {
      note('通讯录·用户详情', false, JSON.stringify(r));
    }
  } else {
    note('通讯录·用户详情', false, '跳过：第 2 步未取到用户');
  }

  // 4. OA 审批：用户可见的审批模板
  let userid = users.length ? users[0].userid : null;
  let templates = [];
  if (userid) {
    r = await post(`${OAPI}/topapi/process/listbyuserid?access_token=${token}`, { userid });
    templates = isOk(r) ? r.result.template_list : [];
    note('OA审批·模板列表', isOk(r),
      isOk(r) ? `${templates.length} 个审批模板，示例: ${templates.slice(0, 5).map(t => t.name).join(', ')}` : JSON.stringify(r));
  } else {
    note('OA审批·模板列表', false, '跳过：没有可用 userid');
  }

  // 5. OA 审批：实例 ID 列表（近 7 天，只取 1 条）
  if (templates.length && templates[0].process_code) {
    const end = Date.now(), start = end - 7 * 24 * 3600 * 1000;
    r = await post(`${OAPI}/topapi/processinstance/listids?access_token=${token}`, {
      process_code: templates[0].process_code, start_time: start, end_time: end, size: 1, cursor: 0,
    });
    note('OA审批·实例ID(近7天)', isOk(r),
      isOk(r) ? `模板「${templates[0].name}」近7天返回 ${r.result.next_cursor === null ? r.result.list.length : '>0'} 条探测记录` : JSON.stringify(r));
  } else {
    note('OA审批·实例ID', false, '跳过：没有可用 process_code');
  }

  // 6. OA 内建应用：企业微应用列表（工作台所有应用，含钉钉内建）
  r = await post(`${OAPI}/topapi/microapp/list?access_token=${token}`, {});
  const apps = isOk(r) ? r.result.list : [];
  note('OA内建应用·微应用列表', isOk(r),
    isOk(r) ? `共 ${apps.length} 个应用（内建 ${apps.filter(a => a.app_type === 'SERVER').length} 个自建/服务型），示例: ${apps.slice(0, 8).map(a => a.name).join(', ')}` : JSON.stringify(r));

  console.log('\n===== 汇总 =====');
  summary.forEach(s => console.log(`${s.ok ? '✅' : '❌'} ${s.name}`));
}

main().catch(e => console.error('脚本异常:', e.message));
