function identifier(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('剧集编号精度已经丢失');
  return value == null ? '' : String(value);
}

export function parseRouterData(html) {
  const block = String(html).match(/(?:window\.)?_ROUTER_DATA\s*=\s*([\s\S]*?)<\/script>/);
  if (!block) throw new Error('页面没有公开的剧集数据');
  const text = block[1].trim();
  if (text[0] !== '{') throw new Error('分享数据不是合法 JSON；不会执行网页脚本');
  let depth = 0, inString = false, escape = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escape) escape = false;
      else if (char === '\\') escape = true;
      else if (char === '"') inString = false;
    } else {
      if (char === '"') inString = true;
      else if (char === '{' || char === '[') depth++;
      else if (char === '}' || char === ']') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(text.slice(0, index + 1)); }
          catch { throw new Error('分享数据不是合法 JSON；不会执行网页脚本'); }
        }
      }
    }
  }
  throw new Error('分享 JSON 数据不完整');
}

export function parseSharePage(html) {
  const router = parseRouterData(html);
  const model = router.loaderData?.['video-animation-share_page'];
  const data = model?.pageData;
  const series = data?.series_data;
  if (!series?.title || !Array.isArray(data.chapter_ids)) throw new Error('分享页缺少标题或剧集列表');
  const ids = data.chapter_ids.map(identifier);
  return {
    seriesId: identifier(model.linkParams?.schemeParams?.video_id || model.params?.series_id),
    title: series.title,
    cover: series.series_cover || '',
    description: series.series_intro || '',
    total: Number(series.serial_count) || ids.length,
    categories: series.category_list || [],
    appId: Number(model.params?.aid),
    episodes: ids.map((id, index) => ({ id, order: index + 1 })),
    currentEpisode: { id: identifier(data.used_chapter_id), order: Number(data.chapter_order), url: series.play_url || '' },
    recommendations: (data.recommend_series || []).map(item => ({
      id: identifier(item.series_id), title: item.series_title || '',
      total: Number(item.episode_cnt) || 0, category: item.category_name || '', cover: item.series_cover || '',
    })),
  };
}

export function parseWebPage(html) {
  const router = parseRouterData(html);
  const model = Object.values(router.loaderData || {}).find(value => value?.seriesDetail);
  if (!model) throw new Error('网页没有作品详情数据');
  const detail = model.seriesDetail;
  const seo = model.publicVideoSeo;
  return {
    seriesId: identifier(detail.series_id || model.series_id), title: detail.series_name || '',
    total: Number(detail.episode_cnt) || 0,
    accessibleEpisodeCount: detail.accessible_episode_cnt == null ? null : Number(detail.accessible_episode_cnt),
    payType: detail.pay_type == null ? null : Number(detail.pay_type),
    episodes: (detail.vid_list || []).map((id, index) => ({ id: identifier(id), order: index + 1 })),
    protectedPlayback: model.protectedPlayback === true,
    publicVideo: seo ? { available: seo.available === true, duration: seo.durationSeconds,
      id: identifier(seo.itemId), fullDurationVerified: false } : null,
    embeddedMediaCount: Array.isArray(model.videoList) ? model.videoList.length : 0,
  };
}

export function buildEpisodePage(originalUrl, episodeId) {
  const original = new URL(originalUrl);
  const result = new URL(original.origin + original.pathname);
  for (const key of ['share_type', 'landing_source', 'use_open_launch_app_novel', 'aid']) {
    if (original.searchParams.has(key)) result.searchParams.set(key, original.searchParams.get(key));
  }
  const zlink = new URL(original.searchParams.get('zlink'));
  const originalParams = JSON.parse(zlink.searchParams.get('schemeParams') || '{}');
  const params = {};
  for (const key of ['video_series_id', 'vs_id_type', 'source', 'module_name', 'share_toast_vid', 'share_ab_group', 'video_id']) {
    if (key in originalParams) params[key] = originalParams[key];
  }
  params.vid = identifier(episodeId);
  const cleanZlink = new URL(zlink.origin + zlink.pathname);
  cleanZlink.searchParams.set('schemeParams', JSON.stringify(params));
  result.searchParams.set('zlink', cleanZlink.href);
  return result.href;
}

export function publicSeriesSummary(series) {
  const { currentEpisode, cover, recommendations, ...rest } = series;
  return {
    ...rest,
    currentEpisode: { id: currentEpisode.id, order: currentEpisode.order, hasMedia: Boolean(currentEpisode.url) },
    recommendations: recommendations.map(({ cover, ...item }) => item),
  };
}
