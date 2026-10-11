// Snapshot tenant và conversation đã xác minh trước khi mở SSE; các bước sau không nhận shopId từ request.
export interface PreparedSellerCopilotChat {
    ownerUserId: string;
    ownerEmail: string;
    ownerPermissions: string[];
    shopId: string;
    conversationId: string;
    modeSessionId: string;
    shopProfile: {
        name: string;
        slug: string;
        description: string | null;
        businessModel: string;
        status: string;
        logoUrl?: string | null;
        contactEmail: string;
        contactPhone: string;
    };
}
