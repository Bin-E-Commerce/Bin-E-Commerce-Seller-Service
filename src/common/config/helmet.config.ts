import type { HelmetOptions } from "helmet";

// Tạo cấu hình Helmet riêng cho seller-service để dev dễ dùng Swagger nhưng production vẫn siết CSP.
export function buildHelmetOptions(isDev: boolean): HelmetOptions {
  return {
    contentSecurityPolicy: isDev
      ? false
      : {
          directives: {
            defaultSrc: ["'self'"],
            baseUri: ["'self'"],
            frameAncestors: ["'none'"],
            objectSrc: ["'none'"],
          },
        },
    crossOriginEmbedderPolicy: false,
  };
}
