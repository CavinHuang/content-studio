# V69 — 独立 POSIX 账号的候选进程源库访问隔离

V68 已保证候选 SQLite 身份不同于生产库，但启动候选进程时若误填真实生产数据库路径，仍可能在预检前打开生产内容。V69 因此新增**必须作为候选进程本身执行**的 OS 权限检查；本 PR 仍是 Draft，不做生产合并和部署。

## 配置受限的候选账号

操作员需要自行创建一个**不同于生产库文件属主的非 root POSIX 用户**，由该账号启动候选服务。应用不会主动创建系统用户、运行 sudo、调整生产文件权限，也不提供 Windows 下相同强度的验收。

生产数据库应由生产用户拥有，访问权限为 0600，建议父目录 0700，以保护随时新建的 WAL/SHM sidecar。候选数据库必须事先创建、由候选用户拥有且权限为 0600，且只允许候选用户写入。操作员应为候选用户授予读取 Node、当前源码及构建文件的能力。确保运行用户没有别的生产数据入口（例如共享服务账号、服务令牌、代理进程）；本工具无法发现所有间接访问路径。

## 在候选系统账号的 shell 启动

```sh
PORT=4312 \
CONTENT_STUDIO_DB_PATH=/encrypted/isolated-candidate.sqlite \
CONTENT_STUDIO_CANDIDATE_SOURCE_DB_PATH=/private/content-studio.sqlite \
npm run candidate:start:v69
```

命令首先验证 candidate DB 是可读写的受限正规文件，属主与当前真实 UID 一致，且当前 UID 不是 root。然后使用同一进程权限对源数据库主文件及现存 WAL/SHM sidecar 尝试 O_RDONLY 打开并立刻关闭（**不会执行 read 或 SQLite 查询**）：如果能打开，直接拒绝启动；源主文件 ENOENT 也不能通过。只有获得 EACCES/EPERM 才是有效拒绝。

Next.js 健康接口每次被访问时重复上述访问能力检查，返回 OS UID、匿名源路径标签、是否拒绝源文件访问、候选库是否归当前 UID 的布尔证据。标签采用公开随机启动 nonce，**不是秘密签名或可信执行证明**。

## V67 操作员终端核验

```sh
npm run release:review:v67 -- \
  --sha=$(git rev-parse HEAD) \
  --db=/private/content-studio.sqlite \
  --candidate-db=/encrypted/isolated-candidate.sqlite \
  --backup-dir=/encrypted/release-backups \
  --scratch-dir=/encrypted/release-scratch \
  --review=/encrypted/v55.operator-review.json \
  --inventory=/encrypted/hosting-v66.private.json \
  --url=http://127.0.0.1:4312/
```

V67 要求源 SQLite owner UID 不等于候选进程的 UID、源文件无组/其他用户读取权限、候选上报源路径标签吻合以及操作系统实际拒绝源库读取，并在 V62 WAL 备份前后再次检查。普通 npm start 的健康接口没有 OS 隔离证明，因此无法通过 V67。

## 已知边界和验证

此机制核查当前 Unix 文件权限和当前运行账户，**不构成永久 OS 沙箱**。POSIX ACL、后续 chmod/chown、相同内容的其他拷贝、容器命名空间不一致、间接服务代理及并发权限改变均可能绕过。生产数据库父目录的权限仍是系统管理员的责任。不能将其作为真实托管商批准或部署许可。

CI 的 `npm run test:os-boundary:v69` 包括文件权限负例，以及 Linux `sudo -u nobody` 下真实分离 UID 的独立读权限测试。CI 对生产数据库不作任何访问；现有 V64 真实 Next.js HTTP smoke 验证普通单用户启动，并不代表已在候选独立 UID 下启动完整生产 Next 服务。

结果始终保留 `mergeAuthorized=false`、`deployAuthorized=false`、`releaseAuthorized=false`、`productionReady=false`。
