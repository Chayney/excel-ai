import {
    CanonicalSchema,
    NormalizedRow,
    ValidationError,
    ValidationResult,
} from "./types";

/**
 * ============================================================
 * Validator
 * ============================================================
 *
 * NormalizerによってCanonical Schemaの型へ変換された
 * データを検証する。
 *
 * Validatorでは値の変換は行わない。
 *
 * 処理順:
 *
 * Parser
 *   ↓
 * Mapping
 *   ↓
 * Normalizer
 *   ↓
 * Validator
 *   ↓
 * Merger
 *   ↓
 * Exporter
 *
 * ============================================================
 */

export const validateRows = (
    rows: NormalizedRow[],
    schema: CanonicalSchema,
    startRowIndex = 2,
): ValidationResult => {
    const errors: ValidationError[] = [];

    /**
     * ========================================================
     * Value → string
     * ========================================================
     *
     * ValidationError.value は string なので、
     * 実際の値を安全に文字列化する。
     */

    function valueToString(value: unknown): string {
        if (value === null || value === undefined) {
            return "";
        }

        if (value instanceof Date) {
            return value.toISOString();
        }

        if (typeof value === "object") {
            try {
                return JSON.stringify(value);
            } catch {
                return String(value);
            }
        }

        return String(value);
    }

    /**
     * ========================================================
     * Empty checker
     * ========================================================
     */

    function isEmpty(value: unknown): boolean {
        return (
            value === null ||
            value === undefined ||
            (typeof value === "string" && value.trim() === "")
        );
    }

    /**
     * ========================================================
     * Date checker
     * ========================================================
     */

    function isValidDate(value: unknown): boolean {
        if (value instanceof Date) {
            return !Number.isNaN(value.getTime());
        }

        if (typeof value === "string") {
            const trimmed = value.trim();

            if (!trimmed) {
                return false;
            }

            const parsed = new Date(trimmed);

            return !Number.isNaN(parsed.getTime());
        }

        return false;
    }

    /**
     * ========================================================
     * Error helper
     * ========================================================
     */

    function addError(
        rowIndex: number,
        column: string,
        code:
            | "REQUIRED"
            | "TYPE"
            | "INVALID_DATE"
            | "INVALID_NUMBER"
            | "INVALID_BOOLEAN",
        message: string,
        value: unknown,
    ): void {
        errors.push({
            rowIndex,
            column,
            code,
            message,
            value: valueToString(value),
        });
    }

    /**
     * ========================================================
     * Row validation
     * ========================================================
     */

    rows.forEach((row, rowIndex) => {
        const excelRow = startRowIndex + rowIndex;

        for (const column of schema.columns) {
            const value = row[column.key];
            const empty = isEmpty(value);

            /**
             * ==================================================
             * 必須チェック
             * ==================================================
             */

            if (column.required && empty) {
                addError(
                    excelRow,
                    column.key,
                    "REQUIRED",
                    `${column.name}は必須項目です。`,
                    value,
                );
                continue;
            }

            /**
             * ==================================================
             * 任意項目の空欄
             * ==================================================
             *
             * 任意項目なら空欄は正常。
             */

            if (empty) {
                continue;
            }

            /**
             * ==================================================
             * 型チェック
             * ==================================================
             */

            switch (column.type) {
                case "string": {
                    if (typeof value !== "string") {
                        addError(
                            excelRow,
                            column.key,
                            "TYPE",
                            `${column.name}は文字列である必要があります。`,
                            value,
                        );
                    }
                    break;
                }

                case "number": {
                    if (
                        typeof value !== "number" ||
                        !Number.isFinite(value)
                    ) {
                        addError(
                            excelRow,
                            column.key,
                            "INVALID_NUMBER",
                            `${column.name}は有効な数値である必要があります。`,
                            value,
                        );
                    }
                    break;
                }

                case "date": {
                    if (!isValidDate(value)) {
                        addError(
                            excelRow,
                            column.key,
                            "INVALID_DATE",
                            `${column.name}は有効な日付である必要があります。`,
                            value,
                        );
                    }
                    break;
                }

                case "boolean": {
                    if (typeof value !== "boolean") {
                        addError(
                            excelRow,
                            column.key,
                            "INVALID_BOOLEAN",
                            `${column.name}はtrue/falseである必要があります。`,
                            value,
                        );
                    }
                    break;
                }

                default: {
                    addError(
                        excelRow,
                        column.key,
                        "TYPE",
                        `${column.name}の型定義が不正です。`,
                        value,
                    );
                    break;
                }
            }
        }
    });

    return {
        valid: errors.length === 0,
        errors,
        errorCount: errors.length,
    };
};
