// Dùng chung chính sách retry cho các HTTP request hạ tầng của Seller Knowledge.
// Chỉ retry lỗi mạng dạng TypeError và HTTP 429/5xx; lỗi nghiệp vụ/ủy quyền không được gửi lặp.
export async function fetchSellerKnowledgeWithRetry(
    provider: 'OpenAI' | 'Qdrant',
    operation: string,
    request: () => Promise<Response>,
): Promise<Response> {
    const maxAttempts = 3;
    const retryableStatuses = new Set([429, 500, 502, 503, 504]);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        let response: Response;

        try {
            response = await request();
        } catch (error) {
            // Fetch dùng TypeError cho lỗi kết nối; timeout/abort và lỗi code khác không retry để không kéo dài request.
            if (!(error instanceof TypeError) || attempt === maxAttempts) {
                throw new Error(
                    `${provider} ${operation} network request failed after ${attempt} attempt(s).`,
                );
            }

            // Backoff ngắn giúp tránh dồn request ngay khi upstream chập chờn, trong khi giới hạn tổng thời gian chờ.
            await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
            continue;
        }

        // Chỉ retry các mã thường mang tính tạm thời; lỗi 4xx khác trả về ngay để caller giữ nguyên thông tin nguyên nhân.
        if (!retryableStatuses.has(response.status) || attempt === maxAttempts)
            return response;

        // Đóng body của phản hồi tạm lỗi trước lần gọi tiếp theo để giải phóng socket và không giữ tài nguyên không dùng.
        await response.body?.cancel().catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }

    // Vòng lặp luôn return hoặc throw; nhánh này chỉ đáp ứng kiểm tra đầy đủ của TypeScript.
    throw new Error(`${provider} ${operation} exhausted its retry attempts.`);
}
