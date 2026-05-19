'use strict';
const supabase = require('./supabase');

async function getCachedOrFetch(accountId, resourceType, queryHash, fetcher, ttlHours = 1) {
  const { data: cached } = await supabase
    .from('meta_resources_cache')
    .select('data')
    .eq('account_id', accountId)
    .eq('resource_type', resourceType)
    .eq('query_hash', queryHash || '')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cached) return { data: cached.data, fromCache: true };

  const data = await fetcher();
  const expires_at = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();

  await supabase.from('meta_resources_cache').upsert({
    account_id: accountId,
    resource_type: resourceType,
    query_hash: queryHash || '',
    data,
    expires_at,
  }, { onConflict: 'account_id,resource_type,query_hash' });

  return { data, fromCache: false };
}

async function invalidateCache(accountId, resourceType) {
  await supabase.from('meta_resources_cache')
    .delete()
    .eq('account_id', accountId)
    .eq('resource_type', resourceType);
}

module.exports = { getCachedOrFetch, invalidateCache };
