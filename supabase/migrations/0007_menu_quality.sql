create or replace view menu_quality_by_business as
select
  business_id,
  count(*) filter (where status = 'published') as published_products,
  count(*) filter (where status = 'published' and image_url is not null) as with_image,
  count(*) filter (where status = 'published' and description is not null and description <> '') as with_description,
  count(*) filter (where status = 'published' and calories is not null) as with_calories,
  count(*) filter (where status = 'published' and array_length(allergens, 1) > 0) as with_allergens,
  count(*) filter (where status = 'published' and base_price is not null) as with_price,
  case when count(*) filter (where status = 'published') = 0 then null
    else round(
      100.0 * (
        count(*) filter (where status = 'published' and image_url is not null) +
        count(*) filter (where status = 'published' and description is not null and description <> '') +
        count(*) filter (where status = 'published' and calories is not null) +
        count(*) filter (where status = 'published' and array_length(allergens, 1) > 0) +
        count(*) filter (where status = 'published' and base_price is not null)
      ) / (5.0 * count(*) filter (where status = 'published')),
      1
    )
  end as quality_score_pct
from products
group by business_id;

alter view menu_quality_by_business set (security_invoker = true);
