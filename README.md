# 钉钉开放平台服务端 API 实测手册

> 基于企业自建应用（企业内部应用）凭证，对钉钉服务端 OpenAPI 逐个实测后整理的手册。
> 所有标记 ✅ 的接口均在真实企业环境中调通，代码片段（Node.js 原生 fetch，无 SDK 依赖）可直接复制运行。
> 实测时间：2026-10，接口能力以钉钉官方文档为准。

## 覆盖范围

| 模块 | 状态 | 说明 |
|---|---|---|
| 鉴权（accessToken） | ✅ | 新版 `api.dingtalk.com` + 旧版 `oapi.dingtalk.com` 双域名规则 |
| 通讯录（部门/用户） | ✅ | 子部门、部门用户分页、用户详情（含 unionid） |
| 企业应用列表 | ✅ | 全部应用 / 内部自建应用（含宜搭 aPaaS 应用识别） |
| OA 审批 / 流程 | ✅ | 表单枚举、表单 Schema、实例 ID 列表、实例详情（数据统计主链路） |
| 宜搭 aPaaS | ⚠️ | 需 `Yida.Form.Read` + 宜搭侧独立凭证（appKey/systemToken） |
| 考勤 | ✅ | 考勤组、打卡结果（旧版）、打卡记录（新版） |
| 待办 | ✅ | 组织待办查询 |
| 公告 | ✅ | 列表、空间、正文详情 |
| 日志（钉钉汇报） | ✅ | 收发列表、详情 |
| 数据中心报表 | ⚠️ | 需 `DataCenter.*.Read` 系列权限 |

## 快速开始

1. 在 [钉钉开放平台](https://open-dev.dingtalk.com) 创建企业内部应用，获取 AppKey/AppSecret
2. 配置环境文件 `~/.dingtalk/.env`：

```ini
DINGTALK_CLIENT_ID=dingxxxxxxxxxxxxxxxx
DINGTALK_CLIENT_SECRET=xxxxxxxxxxxxxxxx
```

3. 跑通第一个请求：

```js
const fs = require('fs');
const env = fs.readFileSync(process.env.USERPROFILE + '/.dingtalk/.env', 'utf8');
const get = k => { const m = new RegExp(k + '=(.*)').exec(env); return m ? m[1].trim() : ''; };

const token = (await (await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ appKey: get('DINGTALK_CLIENT_ID'), appSecret: get('DINGTALK_CLIENT_SECRET') }),
})).json()).accessToken;

// 通讯录：根部门下的子部门
const depts = await fetch('https://oapi.dingtalk.com/topapi/v2/department/listsub?access_token=' + token, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dept_id: 1 }),
}).then(r => r.json());
console.log(depts.result);
```

4. 完整验证脚本见 [probe.js](probe.js)（最小请求探测各类接口可用性）。

## 文档

- [钉钉API手册.md](钉钉API手册.md) — 全部实测接口、参数坑、错误码速查、增量同步架构建议

## 亮点：踩坑速查（详见手册第 0 节）

- 新版域名路径是**驼峰**（如 `/v1.0/microApp/...`），写小写全部 404
- 审批实例查询时间窗 **≤ 120 天**，超窗报 `Invalid timestamp`
- `POST /v1.0/workflow/processInstances` 是**发起**审批不是查询
- 权限未开通报 `60011`，报错信息里自带申请链接
- 新版/旧版分页参数完全不同（`nextToken` vs `cursor` vs `offset`）

## 声明

- 本手册中的企业相关信息（userid、appUuid 等）均为占位符，使用时替换为你自己企业的值
- 请勿将 AppSecret 提交到任何代码仓库；建议用环境变量或密钥管理服务
- 钉钉接口能力随版本迭代可能变化，以官方文档为准
