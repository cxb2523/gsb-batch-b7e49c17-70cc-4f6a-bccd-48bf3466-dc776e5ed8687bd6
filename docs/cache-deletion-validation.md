# 缓存删除流程与验证

## 目标

缓存中心的“删除缓存”需要同时处理三类冲突：当前播放窗口、正在下载/处理的任务，以及单文件被占用或权限不足。删除不是“尽力而为”的静默操作，而是一套可观察、可重试的流程。

## 行为约定

### 1. 播放窗口整体拒绝

`MediaCache.deleteEpisodes(ids)` 在改动任何状态前先检查 `ids`：

- 只要有任意一集仍属于当前播放窗口（`setBufferWindow` 登记的分集），整批请求以 `CACHE_IN_USE` 拒绝。
- 不会删除同一批中的其他分集，也不会取消后台任务。
- `CacheManager.deleteTask` 在暂停队列之前做同样的预检查；被拒绝时任务保持原来的暂停状态和文件。

### 2. 先取消任务，再删除文件

- 对同一批分集上仍在排队、下载或 FFmpeg 处理中的任务调用 `cancel`。
- 等待每个任务的 `completion`（活动任务）或 `promise`（尚未启动的任务）真正结束，包括下载流关闭、编码子进程退出和临时文件清理。
- 等待完成后才执行 unlink，避免“文件已删但任务又写回”或 Windows 上删除仍被占用的文件。
- 删除的分集进入抑制集合；后台轮转不会立刻重新下载它，直到显式播放、重试，或把任务移除后重新添加。

### 3. 部分失败可重试

每个分集的主文件、各画质断点文件（`.partial.mp4` / `.partial.json`）和索引文件（`<key>.json`）独立尝试删除：

- 某个文件失败（`EPERM`、`EBUSY` 等）时，其余文件继续清理，已成功删除的结果保留。
- 全部尝试结束后，如果有失败，返回 `CACHE_DELETE`，提示失败分集数量；响应中不会声称成功。
- 失败分集的主文件仍计入 `usedBytes`；已经删除的分集不再计入。
- 主文件已删但索引删除失败时，索引 key 记入 `deletionMetadata`，`hasDeletionPending` 可观察到残留；再次调用删除会重试该索引。
- 只有该分集没有剩余可追踪文件时，才清理它的失败标记和保护集合；否则保留到重试成功。
- 重试不会把已删除的分集重新算作存在：内存索引中已移除的条目不会再被删除或计入占用。

### 4. 占用字节只统计现存文件

- 删除成功后立即从 `entries` / `partialBytes` 移除对应记录。
- 文件已不存在（`ENOENT`）时也清除对应记录，避免残留计数。
- 删除失败、文件仍存在时继续计数，便于用户看到真实占用并再次清理。
- 缓存中心通过 `snapshot().usedBytes` 展示该值。

## 自动化测试

新增 `tests/cache-deletion.test.ts`，覆盖：

1. 正常批量删除：目标分集文件、索引和字节数下降，其他分集与用户文件保留。
2. 播放窗口内删除被拒：整批 `CACHE_IN_USE`，不取消任务、不删任何文件。
3. 下载中删除：先取消并等待下载任务结束，再移除文件，且不会被后台队列立即重新下载。
4. 处理中删除：终止 FFmpeg 并等待临时文件清理后再完成删除。
5. 单文件被占用：返回 `CACHE_DELETE`，其他分集保持已删除；恢复后重试只清理残留，第三次调用释放 0 字节。
6. 索引删除失败：`hasDeletionPending` 为真；重试成功后索引与标记一起清除。
7. 缓存中心任务删除：文件、队列条目、`usedBytes` 和提示信息同步更新。
8. 缓存中心删除与播放窗口冲突：任务不被暂停，重试条件满足后同一入口可完成删除。
9. 缓存中心删除进行中的任务：取消下载、移除任务、占用归零。

运行：

```powershell
npx tsx --test --test-concurrency=1 tests/cache-deletion.test.ts
```

相关回归：

```powershell
npx tsx --test --test-concurrency=1 `
  tests/cache-manager.test.ts tests/media-buffer.test.ts `
  tests/media-lifecycle.test.ts tests/media-partials.test.ts
```

## 用本地临时目录验证

测试本身只使用操作系统临时目录，不会接触真实缓存：

- 每个用例通过 `mkdtemp(path.join(tmpdir(),'manju-cache-delete-'))` 建立独立目录。
- `MediaCache` 与 `CacheManager` 都指向该目录，下载和编码器由测试桩替代，不访问网络或真实 FFmpeg。
- 删除后直接 `readdir` 该目录核对 `.mp4` / `.json` 残留；`usedBytes` 与目录中实际文件大小对照。
- 用例结束在 `t.after` 中关闭媒体、恢复 `spawn`/`fetch`/`unlink` 桩，并 `rm` 整个临时目录。

手工复核时可在临时目录中观察：

```powershell
$dir = Join-Path ([IO.Path]::GetTempPath()) ("manju-delete-check-" + [guid]::NewGuid())
New-Item -ItemType Directory $dir | Out-Null
# 运行上述测试，将断点放在 deleteEpisodes 之后，查看 $dir 下内容
Get-ChildItem $dir
Remove-Item $dir -Recurse -Force
```

不要对真实缓存目录做占用/权限实验；占用场景由测试把指定文件的 `unlink` 首次调用改为抛 `EPERM` 模拟，其余文件走真实临时文件删除。
