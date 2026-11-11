export function evaluateGate(evidence) {
  const reasons = [];
  if (!evidence.searchVerified) reasons.push('尚未验证指定作品的站内搜索');
  if (!evidence.recommendationsVerified) reasons.push('尚未验证推荐作品进入完整播放流程');
  const series = evidence.series || [];
  const identities = new Set(series.map(item => item.seriesId || item.id).filter(Boolean));
  if (series.length < 2 || identities.size < 2) reasons.push('至少需要两部不同漫剧的证据');
  for (const item of series) {
    const label = item.title || item.seriesId || item.id || '未识别作品';
    if (!item.shareVerified) reasons.push(`${label}：分享入口未验证`);
    if (!item.episodeListVerified) reasons.push(`${label}：全集列表未核对`);
    if (item.expectedEpisodeCount && item.total !== item.expectedEpisodeCount) reasons.push(`${label}：分集数量不符`);
    if (Number.isFinite(item.accessibleEpisodeCount) && item.accessibleEpisodeCount < item.total) {
      reasons.push(`${label}：当前入口仅可访问 ${item.accessibleEpisodeCount}/${item.total} 集`);
    }
    const episodes = item.episodes || [];
    const identified = episodes.filter(episode => typeof episode.id === 'string' && episode.id.length > 0
      && Number.isInteger(episode.order) && episode.order > 0);
    if (identified.length !== episodes.length) reasons.push(`${label}：播放证据缺少有效分集 ID 或顺序`);
    if (new Set(identified.map(episode => episode.id)).size < 3
      || new Set(identified.map(episode => episode.order)).size < 3) reasons.push(`${label}：不足三个不同分集的播放证据`);
    const sequence = item.sequentialEpisodeIds || [];
    const ordered = sequence.map(id => identified.find(episode => episode.id === id));
    if (!item.sequentialPlaybackVerified || ordered.length < 3 || ordered.some((episode, index) =>
      !episode || (index > 0 && episode.order !== ordered[index - 1]?.order + 1))) {
      reasons.push(`${label}：至少三集按相邻集序连续播放未验证`);
    }
    for (const episode of item.episodes || []) {
      if (!episode.fullDurationVerified || !Number.isFinite(episode.expectedDuration) || episode.expectedDuration <= 0
        || !Number.isFinite(episode.duration) || Math.abs(episode.duration - episode.expectedDuration) > 1) {
        reasons.push(`${label}：单集完整时长缺少可核对依据`);
      }
      if (!episode.ended) reasons.push(`${label}：未播放至结尾`);
      if (!episode.seekVerified) reasons.push(`${label}：进度跳转未验证`);
    }
  }
  return { passed: reasons.length === 0, reasons: [...new Set(reasons)] };
}
