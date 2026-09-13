import ExcelJS from "exceljs";

import {
    NormalizedRow,
} from "../canonical/types";

import {
    cellToString,
} from "./parser";

import {
    MergeDefinition,
} from "./merger";

/**
 * ============================================================
 * Exporter
 * ============================================================
 */

export type ExportOptions = {
    sheetName?: string;
};

/**
 * NormalizedRowをXLSX Bufferへ変換する。
 */
export async function exportToXlsx(
    rows: NormalizedRow[],
    definitions: MergeDefinition[],
    options: ExportOptions = {},
): Promise<Buffer> {
    const workbook =
        new ExcelJS.Workbook();

    const worksheet =
        workbook.addWorksheet(
            options.sheetName ||
            "Merged",
        );

    /**
     * ========================================================
     * Headers
     * ========================================================
     */

    const outputColumns =
        definitions.map(
            (definition) =>
                definition.outputColumn,
        );

    worksheet.addRow(
        outputColumns,
    );

    /**
     * ========================================================
     * Data
     * ========================================================
     */

    for (
        const row of rows
    ) {
        worksheet.addRow(
            outputColumns.map(
                (column) =>
                    row[column] ??
                    "",
            ),
        );
    }

    /**
     * ========================================================
     * Header formatting
     * ========================================================
     */

    const headerRow =
        worksheet.getRow(1);

    headerRow.font = {
        bold: true,
    };

    headerRow.alignment = {
        vertical: "middle",

        horizontal: "center",
    };

    headerRow.fill = {
        type: "pattern",

        pattern: "solid",

        fgColor: {
            argb: "D9EAF7",
        },
    };

    /**
     * ========================================================
     * Freeze header
     * ========================================================
     */

    worksheet.views = [
        {
            state: "frozen",

            ySplit: 1,
        },
    ];

    /**
     * ========================================================
     * Column width
     * ========================================================
     */

    worksheet.columns =
        outputColumns.map(
            (
                column,
                index,
            ) => {
                let maxLength =
                    column.length;

                for (
                    let rowIndex = 2;
                    rowIndex <=
                    Math.min(
                        worksheet.rowCount,
                        101,
                    );
                    rowIndex++
                ) {
                    const value =
                        worksheet
                            .getRow(
                                rowIndex,
                            )
                            .getCell(
                                index + 1,
                            )
                            .value;

                    const length =
                        cellToString(
                            value,
                        ).length;

                    maxLength =
                        Math.max(
                            maxLength,
                            length,
                        );
                }

                return {
                    header:
                        column,

                    key:
                        column,

                    width:
                        Math.min(
                            Math.max(
                                maxLength +
                                2,
                                10,
                            ),
                            50,
                        ),
                };
            },
        );

    /**
     * ========================================================
     * Buffer
     * ========================================================
     */

    const outputBuffer =
        await workbook.xlsx.writeBuffer();

    return Buffer.from(
        outputBuffer,
    );
}
