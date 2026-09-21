-- Historical acquisition rows sometimes copied a social profile returned by
-- Google Places into both `website` and the matching public-channel column.
-- Preserve the URL in its real channel and clear only the incorrectly typed
-- website value so later official-site collection is not skipped.
update public.customers
set facebook_url = coalesce(nullif(facebook_url, ''), website),
    website = null,
    updated_at = now()
where website ~* '^https?://([^/]+\.)?(facebook\.com|fb\.com)(/|$)';

update public.customers
set instagram_url = coalesce(nullif(instagram_url, ''), website),
    website = null,
    updated_at = now()
where website ~* '^https?://([^/]+\.)?instagram\.com(/|$)';

update public.customers
set linkedin_url = coalesce(nullif(linkedin_url, ''), website),
    website = null,
    updated_at = now()
where website ~* '^https?://([^/]+\.)?linkedin\.com(/|$)';

update public.customers
set tiktok_url = coalesce(nullif(tiktok_url, ''), website),
    website = null,
    updated_at = now()
where website ~* '^https?://([^/]+\.)?tiktok\.com(/|$)';
