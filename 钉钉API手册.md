# 钉钉开放平台 API 手册（企业自建应用实测版）

> 用企业自建应用凭证逐个实测后整理。标 ✅ 的都是真实调通的，代码片段（Node.js 原生 fetch）可直接复制运行。
> 文中 `<...>` 占位符替换为你自己企业的值；凭证建议放 `~/.dingtalk/.env`（DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET）。
> 实测时间：2026-10，接口能力以官方文档为准。

## 本手册使用的占位符

| 占位符 | 含义 | 获取方式 |
|---|---|---|
| `<admin-userid>` | 管理员的 userid | 通讯录接口或后台查看（权限类接口尽量用它） |
| `<admin-unionid>` | 管理员的 unionid | `topapi/v2/user/get` 返回 |
| `<sample-userid>` | 任意普通员工 userid | 部门用户列表接口 |
| `<agent-id>` | 应用 agentId | 应用列表接口返回 |
| `<app-uuid>` | 宜搭应用 appUuid | 应用列表返回的 homepageLink URL 参数里解析 |
| `<process-code>` | 审批表单编码（`PROC-` 开头） | 表单枚举接口返回 |
| `<dept-id>` | 部门 ID | 部门列表接口返回 |

---

## 0. 通用规则（先读这个，少踩 90% 的坑）

**两套域名，两种鉴权，别混用：**

| 域名 | 鉴权方式 | 说明 |
|---|---|---|
| `https://api.dingtalk.com`（新版） | Header `x-acs-dingtalk-access-token` | 所有 `/v1.0/` `/v2.0/` 路径 |
| `https://oapi.dingtalk.com`（旧版） | URL 参数 `?access_token=xxx` | 所有 `/topapi/` 及根路径 |

**获取 access_token（2 小时有效，必须缓存复用）：**

```js
const r = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ appKey, appSecret }),
}).then(r => r.json());
// r.accessToken, r.expireIn = 7200
```

**高频错误码速查：**

| 错误 | 含义 | 处理 |
|---|---|---|
| `errcode 60011` / `Forbidden.AccessDenied.AccessTokenPermissionDenied` | 权限点未开通 | errmsg 里有现成申请链接，管理员点击开通即可 |
| `errcode 22` "不合法ApiName" | 旧接口已下线或路径写错 | 换本手册里的新接口 |
| `errcode 400003` Invalid timestamp | 查询时间范围超限 | 实例查询窗口 ≤ 120 天，分段拉 |
| `InvalidAction.NotFound` | 路径不存在 / 大小写错 / HTTP 方法错 | 对照本手册；注意 `microApp` 是驼峰！ |
| `MissingXxx` | 缺必填参数 | 常见漏 `offset`（旧版分页）、`nextToken`/`maxResults`（新版分页） |

**分页三种模式，别记混：**
- 新版列表：`nextToken`（数字，从 0 开始，翻到底返回 `null`/`undefined`）+ `maxResults`
- 旧版 topapi：`cursor` + `size`（`has_more`/`next_cursor`）
- 部分旧接口（如 `process/listbyuserid`）：`offset` + `size`

---

## 1. 通讯录 ✅ 全通

```js
const post = (path, body) => fetch(`https://oapi.dingtalk.com${path}?access_token=${token}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}).then(r => r.json());

// 子部门列表（dept_id=1 是根部门）
await post('/topapi/v2/department/listsub', { dept_id: 1 });
// → result: [{ dept_id, name, parent_id }, ...]

// 部门用户分页（cursor 从 0 开始，has_more 判断继续）
await post('/topapi/v2/user/list', { dept_id: <dept-id>, cursor: 0, size: 100 });
// → result: { has_more, next_cursor, list: [{ userid, name, active, dept_id_list, ... }] }

// 用户详情（含 unionid、mobile、email、title 等）
await post('/topapi/v2/user/get', { userid: '<admin-userid>' });
```

- ❌ 新版 `GET /v1.0/contact/users/{unionid}` 实测返回"找不到该用户"（勿用，旧版够用）
- 用户详情可读字段：name、mobile、email、unionid、title、dept_id_list、active、avatar、job_number（部分人有）

---

## 2. 企业应用列表 ✅ 全通（解决"业务应用枚举"问题）

```js
const get = (path) => fetch(`https://api.dingtalk.com${path}`, {
  headers: { 'x-acs-dingtalk-access-token': token }
}).then(r => r.json());

// 企业工作台全部应用（含钉钉内建 + 第三方 + 宜搭 aPaaS），顶层 appList 字段！
await get('/v1.0/microApp/allApps');
await get('/v1.0/microApp/allInnerApps');   // 仅内部自建

// 单个内部应用详情（注意路径是 innerapps 全小写复数）
await get(`/v1.0/microApp/apps/innerapps/<agent-id>`);
// → { agentId, appName, ... }
```

⚠️ **路径大小写是 `/v1.0/microApp/...`**（驼峰），写成小写 `microapp` 全部 404。
⚠️ 返回体是顶层 `{ appList: [...] }`，不在 `result` 里。
宜搭 aPaaS 应用的 `appUuid` 在 `pcHomepageLink`/`ompLink` URL 参数里，需自行解析（域名 `aflow.dingtalk.com` 的应用就是宜搭搭的）。

- ❌ `POST /v1.0/microApp/visibleScopes/query`：需 `qyapi_corpapp_manage` 权限
- ❌ 旧版 `topapi/microapp/list` 已彻底下线（报"远程服务不存在"）

---

## 3. OA 审批 / 流程 ✅ 核心全通（统计主路径）

### 3.1 枚举表单（管理员权限一次拿全）

```js
// 可管理的全部表单（用管理员 userid，含全部 processCode）
await get(`/v1.0/workflow/processes/managements/templates?userId=<admin-userid>`);
// → result: [{ flowTitle, processCode, gmtModified, iconUrl, ... }]

// 用户可见的表单（nextToken/maxResults 必填！）
await get(`/v1.0/workflow/processes/userVisibilities/templates?userId=<admin-userid>&maxResults=100&nextToken=0`);
// → result: { processList: [{ processCode, name, url, ... }], nextToken }
```

### 3.2 表单 Schema（审批节点配置）

```js
// appUuid + processCode 查表单定义（GET + query 传参）
await get(`/v1.0/workflow/forms/schemaAndProcess?appUuid=<app-uuid>&processCode=<process-code>`);
// → result: { processConfig: "[{\"name\":\"审批节点名\",...}]", handSignEnable, appType }
```

### 3.3 实例数据拉取（统计核心链路）

```js
// 第 1 步：实例 ID 列表 —— 时间窗不能超过 120 天！
const post2 = (path, body) => fetch(`https://api.dingtalk.com${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': token },
  body: JSON.stringify(body)
}).then(r => r.json());

const ids = await post2('/v1.0/workflow/processes/instanceIds/query', {
  processCode: '<process-code>',
  startTime: Date.now() - 119 * 86400000,
  endTime: Date.now(),
  nextToken: 0,          // 数字，从 0 开始；翻到底返回 null/undefined
  maxResults: 20,
});
// → result: { list: ['实例ID', ...], nextToken }

// 第 2 步：实例详情（旧版接口，表单值全在这里）
const detail = await post(`/topapi/processinstance/get`, { process_instance_id: ids.result.list[0] });
// → process_instance: { title, status(RUNNING/TERMINATED/COMPLETED), result(agree/refuse),
//    create_time, finish_time, originator_userid, form_component_values: [{ name, value, component_type }] }
```

**旧版实例 ID 接口也能用**（分窗同样 ≤120 天）：
```js
await post('/topapi/processinstance/listids', { process_code, start_time, end_time, size: 20, cursor: 0 });
```

### 3.4 已废弃 / 勿用

| 接口 | 状态 |
|---|---|
| `POST /v1.0/workflow/processInstances` | 这是**发起**实例不是查询！会报 MissingformComponentValues |
| `oapi/topapi/process/list` | 已下线（不合法ApiName） |
| `oapi/topapi/process/get` | 已下线 |
| `GET /v1.0/workflow/processCentres/schemaNames/processCodes?name=` | 只支持审批中心模板，查宜搭表单报"模板不存在" |
| `oapi/topapi/process/listbyuserid` | 通，但只返回"普通审批模板"；宜搭业务表单不在此列（需 offset 参数） |

> 重要认知：企业里大量"业务应用"审批实际是宜搭 aPaaS 应用（第 2 节识别），它们的 `PROC-` 编码**同样走 3.3 的 workflow 实例接口**，两条路都通。

---

## 4. 宜搭 aPaaS ⚠️ 双重门槛

```js
// 应用表单列表
await post2('/v1.0/yida/apps/forms/query', { appType: '<app-uuid>', pageNumber: 1, pageSize: 10 });
// 实例搜索
await post2('/v2.0/yida/forms/instances/search', { appType: '<app-uuid>', currentPage: 1, pageSize: 5 });
```

宜搭接口有两道门槛：
1. 钉钉侧权限 `Yida.Form.Read`（开放平台 → 权限管理开通）
2. **宜搭侧独立凭证**：`appKey` + `systemToken`（宜搭开发者后台 → 应用 → API-SDK 页面获取），与钉钉开放平台凭证是两套

其他已确认存在的端点（SDK 里挖出，双凭证齐了可试）：
- `POST /v2.0/yida/forms/instances/ids/{appType}/{formUuid}` 按表单查实例 ID
- `POST /v1.0/yida/forms/instances/advances/queryAll` 全量查询
- `GET /v2.0/yida/forms/instances/{id}` 单条详情

> 备注：宜搭应用的审批实例也可不走宜搭接口，直接用第 3.3 节 workflow 实例接口拉（已实测可读），数据统计优先走这条路。

---

## 5. 考勤 ✅ 全通

```js
// 考勤组列表 ✅
await post('/topapi/attendance/getsimplegroups', { offset: 0, size: 10 });
// → result: { groups: [{ group_id, group_name, default_class_id, classes_list }] }

// 打卡结果（旧版，字段全）✅
await post('/attendance/list', { userId: '<sample-userid>', workDateFrom: '2026-10-20 00:00:00', workDateTo: '2026-10-20 23:59:59' });
// → recordresult: [{ userCheckTime, timeResult, locationResult, ... }]

// 打卡记录（新版，批量）✅ —— 注意三个坑：
//   1. 参数名是 userIdList 不是 userIds
//   2. startTime/endTime 是毫秒时间戳，不是日期字符串
//   3. operatorUserId 必填（传管理员 userid）
await post2('/v1.0/attendance/checkin/records/query', {
  userIdList: ['<sample-userid>'],
  startTime: Date.now() - 3 * 86400000,
  endTime: Date.now(),
  operatorUserId: '<admin-userid>',
  maxResults: 50, nextToken: 0,
});
// → result: { pageList: [...] }
// ⚠️ GET /v1.0/attendance/groups 是 404（那是创建/更新用的），列组用旧版 getsimplegroups
```

> 注：不在考勤组的用户（管理层/自由工时）返回空列表是正常业务现象。

---

## 6. 待办 ✅

```js
// 组织待办查询（unionId 从 v2/user/get 拿）
await post2(`/v1.0/todo/users/<admin-unionid>/org/tasks/query`, { currentMaxResults: 10 });
// → { todoCards: [], totalCount }

// 按来源查
await get(`/v1.0/todo/users/<admin-unionid>/tasks/sources/0?maxResults=5&nextToken=0`);
```

- ⚠️ `GET /v1.0/todo/users/{unionid}/tasks` 是 404；`POST` 同路径是**创建**任务
- ⚠️ `/tasks/count` 参数诡异（decodeId is null），勿用

---

## 7. 公告 ✅ 全通

```js
// 用户可见公告（最新 10 条，含标题/链接/时间）✅
await post('/topapi/blackboard/listtopten', { userid: '<admin-userid>' });
// → blackboard_list: [{ id, title, url, gmt_create, ... }]

// 公告空间 ✅
await get(`/v1.0/blackboard/spaces?operationUserId=<admin-userid>&size=10`);
// → { spaceId: "..." }

// 公告正文详情 ✅（需 qyapi_blackboard_manage 权限）
await get(`/v1.0/blackboard/get_blackboard?operationUserId=<admin-userid>&blackboardId=<id>`);
// → { title, gmtCreate, gmtModified, ...正文内容 }
```

- ❌ `oapi/topapi/blackboard/list` 已下线（不合法ApiName），用 `listtopten`

---

## 8. 日志（钉钉汇报）✅ 列表+详情全通

```js
// 用户发出/收到的日志列表（nextToken 必填！时间戳毫秒）
await get(`/v1.0/report/users/sendAndReceiveLists?operationUserId=<admin-userid>`
  + `&startTime=${Date.now()-30*86400000}&endTime=${Date.now()}&maxResults=20&nextToken=0&queryType=send`);
// → { dataList: [{ reportId, templateName, creatorName, creatorId, createTime, modifiedTime }], nextToken }

// 日志详情（含部门、内容）✅
await get(`/v1.0/report/details?reportId=${reportId}&operationUserId=<admin-userid>`);
```

- ❌ 旧版 `topapi/report/gettemplatelist` / `gettemplate` / `template/list` 全部已下线
- 日志模板列表新接口未见直接替代（SDK 里只有统计规则 `statisticalRules/results`），从列表接口反推模板即可

---

## 9. 数据中心（钉钉自带统计报表）⚠️ 差权限

```js
await get(`/v1.0/datacenter/approvalData?statDate=2026-10-20`);
// 需 DataCenter.Approval.Read
// 同系列还有 attendanceData / checkinData / blackboardData / activeUserData（需对应 DataCenter.*.Read）
```

开通后可替代部分自建统计。

---

## 10. 常用权限点清单（管理员在开放平台 → 权限管理开通）

| 权限点 | 解锁能力 |
|---|---|
| `Yida.Form.Read` | 宜搭表单/实例数据（注意还需宜搭侧 appKey+systemToken） |
| `qyapi_checkin_read` | 新版打卡记录 |
| `qyapi_attendance_isv_query_result`、`qyapi_get_attendance_data` | 旧版打卡结果 |
| `qyapi_blackboard_read` / `qyapi_blackboard_manage` | 公告列表/详情 |
| `DataCenter.Approval.Read` 等系列 | 钉钉自带统计报表 |
| `qyapi_corpapp_manage` | 应用可见范围管理 |

申请链接格式（60011 报错里也直接给）：
`https://open-dev.dingtalk.com/appscope/apply?content=<clientId>%23<权限点名>`

---

## 11. 统计拉数建议架构（已验证可行）

```
定时任务（如每 10 分钟 / 每天一次）
  1. 取缓存 token（2h 有效期，过期重取）
  2. instanceIds/query 按 119 天窗口滑动 + nextToken 翻页 → 新实例 ID
  3. 与本地库已有 ID 做差集 → 只拉增量
  4. processinstance/get 逐条拉详情（限速 ~5 QPS 以下）
  5. 解析 form_component_values 落库
  6. 断点记录 (processCode, lastEndTime)，异常可重跑
```

注意事项：
- 时间窗严格 ≤ 120 天，跨窗用多段
- `form_component_values[].value` 是 JSON 字符串（多选/子表单要二次 parse）
- 审批中实例 status=RUNNING，终态后可能被更新，建议终态实例也定期校验最近 N 天
- 找接口真实路径的方法：下载官方 npm SDK `@alicloud/dingtalk` 的 tgz，在 `dist/<模块>_1_0/client.js` 里 grep `pathname`——文档站搜不到的路径全在里面
