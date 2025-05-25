// vps-gemini-worker/src/types/vps.types.ts

// Các import cần thiết từ thư viện @google/generative-ai
// Đảm bảo bạn đã cài đặt thư viện này trong project VPS phụ: npm install @google/generative-ai
import {
    type UsageMetadata,
    type Part, // Dùng cho fewShotParts
    type GenerationConfig as SDKGenerationConfig, // Dùng cho generationConfig
    type Content, // Dùng khi build GenerateContentRequest
    type GenerateContentRequest, // Dùng khi build GenerateContentRequest
    type GenerativeModel // Kiểu của model sau khi được khởi tạo
} from "@google/generative-ai";

/**
 * Thông tin cơ bản về batch/item được gửi từ server chính.
 * Được lồng trong VpsTaskPayload.
 */
export interface BaseVpsGeminiParams {
    batchIndex: number;
    title: string; // Đảm bảo server chính gửi string, không phải undefined
    acronym: string; // Đảm bảo server chính gửi string, không phải undefined
}

/**
 * Payload mà VPS worker nhận được từ server chính để thực hiện một tác vụ Gemini API.
 * Phải khớp với `VpsApiPayload` được định nghĩa ở server chính.
 */
export interface VpsTaskPayload {
    /** Thông tin ngữ cảnh cơ bản của request. */
    baseParams: BaseVpsGeminiParams;

    /**
     * Loại API (ví dụ: 'extract', 'determine', 'cfp').
     * VPS sử dụng thông tin này để chọn API key phù hợp (nếu VPS có nhiều key cho các mục đích khác nhau).
     */
    apiType: string;

    /** Tên model Gemini cụ thể mà server chính yêu cầu VPS sử dụng. */
    modelName: string;

    /** Prompt chính để gửi đến Gemini API. */
    prompt: string;

    /** System instruction (nếu có) cho model. */
    systemInstruction?: string;

    /**
     * Mảng các `Part` cho few-shot examples (nếu có).
     * Định dạng: [{text: "user_input1"}, {text: "model_output1"}, {text: "user_input2"}, ...]
     */
    fewShotParts?: Part[];

    /**
     * Toàn bộ object cấu hình cho việc generate content của Gemini SDK.
     * Bao gồm temperature, topP, topK, maxOutputTokens, responseMimeType, responseSchema, etc.
     */
    generationConfig: SDKGenerationConfig;

    // Ghi chú: crawlModel (tuned/non-tuned) không còn cần thiết trong payload này
    // vì server chính đã quyết định các tham số (modelName, systemInstruction,
    // fewShotParts, generationConfig) cuối cùng để VPS sử dụng.
}

/**
 * Kết quả trả về từ việc thực thi SDK Gemini thành công trên VPS.
 * Đây là phần `data` trong `VpsTaskResponse` nếu `success` là true.
 * Phải khớp với `VpsSdkResult` được định nghĩa ở server chính.
 */
export interface VpsSdkExecutionResult {
    /** Nội dung text trả về từ Gemini API. */
    responseText: string;

    /** Metadata về việc sử dụng (ví dụ: token count) từ Gemini API. */
    metaData: UsageMetadata | null;
}

/**
 * Cấu trúc lỗi chi tiết được gửi về server chính nếu có vấn đề xảy ra trên VPS.
 * Đây là phần `error` trong `VpsTaskResponse` nếu `success` là false.
 */
export interface VpsErrorDetail {
    /** Thông báo lỗi chính. */
    message: string;

    /** Tên của lỗi (ví dụ: 'VpsRateLimitError', 'SyntaxError'). */
    name?: string;

    /** Stack trace của lỗi (thường chỉ gửi ở môi trường development). */
    stack?: string;

    /** Các chi tiết bổ sung về lỗi (ví dụ: thông tin từ RateLimiterRes). */
    details?: any;
}

/**
 * Response đầy đủ mà VPS worker gửi trả lại cho server chính.
 * Phải khớp với `VpsApiResponse` mà server chính mong đợi.
 */
export interface VpsTaskResponse {
    /**
     * Trạng thái thành công của việc xử lý tác vụ trên VPS.
     * `true` nếu VPS gọi Gemini API thành công và có kết quả.
     * `false` nếu có bất kỳ lỗi nào xảy ra trong quá trình VPS xử lý (lỗi chuẩn bị model, lỗi rate limit, lỗi SDK, ...).
     */
    success: boolean;

    /**
     * Dữ liệu kết quả nếu `success` là `true`.
     * Sẽ là `undefined` nếu `success` là `false`.
     */
    data?: VpsSdkExecutionResult;

    /**
     * Thông tin lỗi nếu `success` là `false`.
     * Sẽ là `undefined` nếu `success` là `true`.
     */
    error?: VpsErrorDetail;
}


/**
 * (Nội bộ VPS) Kết quả của việc chuẩn bị model và request trước khi gọi SDK.
 * Được sử dụng bởi VpsGeminiSdkExecutorService.
 */
export interface VpsModelPreparationResult {
    /** Instance GenerativeModel đã được khởi tạo. */
    model: GenerativeModel;

    /**
     * Request hoàn chỉnh để gửi đến `model.generateContent()`.
     * Có thể là một object `GenerateContentRequest` (nếu có history/few-shot)
     * hoặc một string (nếu chỉ có prompt đơn giản - ít dùng hơn với API mới).
     * Thông thường sẽ là `GenerateContentRequest` để bao gồm `generationConfig`.
     */
    contentRequest: GenerateContentRequest; // Luôn là object để chứa generationConfig

    /** Tên model thực sự được sử dụng cho lần gọi này. */
    modelNameUsed: string;
}

// Bạn có thể thêm các kiểu dữ liệu nội bộ khác mà VPS cần ở đây.
// Ví dụ: nếu bạn có các service con trong VPS cần các kiểu dữ liệu riêng.