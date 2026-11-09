/** `payload` with the other school field cleared, or throws if it sets both `school_id` and `school`. */
export function schoolChoice<T extends Record<string, unknown>>(payload: T): T;
