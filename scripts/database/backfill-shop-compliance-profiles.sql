-- Chạy một lần sau khi schema shop_compliance_profiles đã được tạo để nâng cấp các shop được duyệt trước kiến trúc compliance.
-- Script chỉ sao chép hồ sơ đầy đủ; dữ liệu thiếu vẫn được giữ nguyên để vận hành xử lý thủ công, không chèn placeholder giả.

BEGIN;

INSERT INTO shop_compliance_profiles (
  shop_id,
  profile_type,
  legal_name,
  citizen_id,
  tax_code,
  representative_name,
  representative_role,
  legal_contact_email,
  legal_contact_phone,
  verification_documents,
  bank_code,
  bank_name,
  bank_account_number,
  bank_account_holder_name,
  bank_account_type,
  bank_branch,
  version,
  verified_at
)
SELECT
  shop.id,
  application.profile_type::text::shop_compliance_profiles_profile_type_enum,
  application.legal_name,
  application.citizen_id,
  application.tax_code,
  application.representative_name,
  application.representative_role,
  application.contact_email,
  application.contact_phone,
  application.verification_documents,
  application.bank_code,
  application.bank_name,
  application.bank_account_number,
  application.bank_account_holder_name,
  application.bank_account_type::text::shop_compliance_profiles_bank_account_type_enum,
  application.bank_branch,
  1,
  COALESCE(application.reviewed_at, shop.verified_at, NOW())
FROM shops AS shop
INNER JOIN seller_applications AS application
  ON application.id = shop.seller_application_id
WHERE application.status::text = 'approved'
  AND NULLIF(BTRIM(application.legal_name), '') IS NOT NULL
  AND NULLIF(BTRIM(application.representative_name), '') IS NOT NULL
  AND NULLIF(BTRIM(application.contact_email), '') IS NOT NULL
  AND NULLIF(BTRIM(application.contact_phone), '') IS NOT NULL
  AND NULLIF(BTRIM(application.bank_code), '') IS NOT NULL
  AND NULLIF(BTRIM(application.bank_name), '') IS NOT NULL
  AND NULLIF(BTRIM(application.bank_account_number), '') IS NOT NULL
  AND NULLIF(BTRIM(application.bank_account_holder_name), '') IS NOT NULL
  AND (
    (
      application.profile_type::text = 'individual'
      AND NULLIF(BTRIM(application.citizen_id), '') IS NOT NULL
      AND NULLIF(
        BTRIM(application.verification_documents -> 'citizenIdFront' ->> 'url'),
        ''
      ) IS NOT NULL
      AND NULLIF(
        BTRIM(application.verification_documents -> 'citizenIdBack' ->> 'url'),
        ''
      ) IS NOT NULL
    )
    OR
    (
      application.profile_type::text = 'business'
      AND NULLIF(BTRIM(application.tax_code), '') IS NOT NULL
      AND NULLIF(
        BTRIM(application.verification_documents -> 'businessLicense' ->> 'url'),
        ''
      ) IS NOT NULL
      AND NULLIF(
        BTRIM(application.verification_documents -> 'representativeDocument' ->> 'url'),
        ''
      ) IS NOT NULL
    )
  )
ON CONFLICT (shop_id) DO NOTHING;

COMMIT;

-- Kết quả còn lại là shop legacy thiếu dữ liệu bắt buộc và cần được kiểm tra thủ công trước khi kích hoạt hồ sơ compliance.
SELECT
  shop.id AS shop_id,
  shop.name AS shop_name,
  application.id AS application_id,
  application.user_email
FROM shops AS shop
INNER JOIN seller_applications AS application
  ON application.id = shop.seller_application_id
LEFT JOIN shop_compliance_profiles AS compliance
  ON compliance.shop_id = shop.id
WHERE compliance.id IS NULL
ORDER BY shop.created_at ASC;
