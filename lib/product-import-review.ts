import { validateNormalizedProduct } from "@/lib/product-import";
import { isProductFamily, normalizeProductSpecifications } from "@/lib/product-specifications";
import { createAdminClient } from "@/lib/supabase/admin";

export async function reviewProductImportData(admin: ReturnType<typeof createAdminClient>, input: unknown) {
  const { normalized, issues } = validateNormalizedProduct(input);
  if (normalized.category_id && !issues.some((issue) => issue.includes("商品分类"))) {
    const category = await admin.from("product_categories").select("product_family,is_active").eq("id", normalized.category_id).maybeSingle();
    if (category.error) throw category.error;
    if (!category.data?.is_active || !isProductFamily(category.data.product_family)) issues.push("商品分类不存在或已停用");
    else {
      const checked = normalizeProductSpecifications(normalized.specifications, category.data.product_family);
      if (checked.error) issues.push(checked.error);
      else normalized.specifications = checked.specifications;
    }
  }
  return { normalized, issues };
}
