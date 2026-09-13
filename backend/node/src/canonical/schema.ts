import { CanonicalSchema } from "./types";

/**
 * ============================================================
 * Canonical Schema
 * ============================================================
 *
 * すべてのExcel / CSVを最終的にこの構造へ統一する。
 *
 * Excel側の列名はこのSchemaのaliasesを使ってMappingする。
 *
 * 出力Excelの列名は必ずnameを使用する。
 *
 * 重要:
 *
 * sourceColumn:
 *   sale
 *
 * canonical:
 *   sales_amount
 *
 * output:
 *   売上高
 *
 * という関係になる。
 */

export const CANONICAL_SCHEMA: CanonicalSchema = {
    version: "1.0.0",
    columns: [
        {
            key: "company_id",
            name: "会社ID",
            type: "string",
            required: false,
            aliases: [
                "company_id",
                "companyId",
                "company id",
                "会社ID",
                "会社コード",
            ],
            normalizer: "string",
        },
        {
            key: "store_id",
            name: "店舗ID",
            type: "string",
            required: true,
            aliases: [
                "store_id",
                "storeId",
                "store id",
                "店舗ID",
                "店舗コード",
                "店舗番号",
                "店番",
            ],
            normalizer: "store_id",
        },
        {
            key: "store_name",
            name: "店舗名",
            type: "string",
            required: false,
            aliases: [
                "store_name",
                "storeName",
                "store name",
                "店舗名",
                "店舗名称",
                "店名",
            ],
            normalizer: "trim",
        },
        {
            key: "sales_date",
            name: "売上日",
            type: "date",
            required: true,
            aliases: [
                "sales_date",
                "salesDate",
                "sales date",
                "date",
                "売上日",
                "売上日付",
                "日付",
            ],
            normalizer: "date",
        },
        {
            key: "sales_amount",
            name: "売上高",
            type: "number",
            required: true,
            aliases: [
                "sale",
                "sales",
                "sales_amount",
                "salesAmount",
                "sales amount",
                "revenue",
                "売上",
                "売上高",
                "売上金額",
            ],
            normalizer: "number",
        },
        {
            key: "gross_profit",
            name: "粗利益",
            type: "number",
            required: false,
            aliases: [
                "gross_profit",
                "grossProfit",
                "gross profit",
                "粗利益",
                "粗利",
            ],
            normalizer: "number",
        },
        {
            key: "operating_profit",
            name: "営業利益",
            type: "number",
            required: false,
            aliases: [
                "operating_profit",
                "operatingProfit",
                "operating profit",
                "営業利益",
            ],
            normalizer: "number",
        },
    ],
};


export function getCanonicalColumn(key: string) {
    return CANONICAL_SCHEMA.columns.find(
        (column) => column.key === key,
    );
}


export function getCanonicalColumnByName(name: string) {
    return CANONICAL_SCHEMA.columns.find(
        (column) => column.name === name,
    );
}
