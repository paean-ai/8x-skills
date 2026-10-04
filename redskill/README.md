# Red Skill 发行版

`paean-rednote-create` 是面向小红书的中文创作入口：默认完成本地作品与小工具离线包，按需生成 8x 平台版、演示素材或公开发布。它复用本仓库现有实现，不需要独立仓库。

## 构建

在仓库根运行（Node.js 18+，无额外构建依赖）：

```bash
node scripts/build-redskill.mjs
node scripts/build-redskill.mjs --check
```

输出：

- `dist/redskill/paean-rednote-create/`：可独立安装或上传的完整技能目录。
- `dist/redskill/paean-rednote-create-0.1.0.zip`：ZIP 根直接包含 `SKILL.md`。

本目录中的 `paean-rednote-create/` **是发行入口源文件，不是完整安装包**。构建器将 `release.json` 中的 7 个规范源工作流按原目录结构放进产物的 `workflows/`，包括用于演示配音和 8x 版语音素材的 `paean-tts`（运行需 Node.js 20+ 与自己的 Paean 登录），附上根 LICENSE 与逐文件 SHA-256 清单。构建本身不运行安装器，不接触用户凭证，也不访问网络。

`--out <directory>` 可用于临时构建；仓库内输出仅允许放在 `dist/`。`--check` 比较当前源码与已有目录/ZIP，不写文件。构建器拒绝覆盖未标记为本工具产物的目录。

## 维护

- 专用的中文入口与平台差异：编辑这里的 `paean-rednote-create/`。
- 共用脚本、参考和原版工作流：编辑 `claude-code/`，按原流程同步 `codex/` 与 `zero/`，然后重新构建发行包。
- 版本及所需工作流：编辑 `release.json`。相同文件集的 ZIP 可重复生成相同字节，清单记录实际文件来源与哈希，不将未提交改动误标为某个 Git 版本。
- 不提交生成的 `dist/`；交付或上架使用构建后的目录/ZIP，不上传整个仓库。

```bash
node --test tests/redskill-bundle.test.mjs
node --test tests/*.test.mjs
```

上架介绍草稿、依赖披露与待核验事项见 [delivery.md](paean-rednote-create/references/delivery.md)。`.mjs` 上传支持、线上审核和实际 Agent 自动发现仍需平台验证。开发工具包的依赖范围与作品小工具容器的离线限制不同。
