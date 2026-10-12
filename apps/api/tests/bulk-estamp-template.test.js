import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import ExcelJS from "exceljs";
import { Organization, Wallet, Article, ArticleVersion, User, BulkEStampBatchItem } from "../src/models/index.js";
import { Role, OrganizationStatus } from "@launcherdesk/shared";
import * as bulkController from "../src/controllers/bulk-estamp.controller.js";
import { BulkEStampService } from "../src/services/bulk-estamp.service.js";
import { makeReq } from "./helpers/http.js";

// downloadTemplate streams a binary xlsx via res.setHeader/write/end rather
// than res.json, so the shared makeRes()/runController() test helpers (built
// around res.json) don't fit here - this tiny mock captures the written
// bytes and resolves once end() is called, mirroring how Express would
// actually flush the response.
function makeStreamingRes() {
  const chunks = [];
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    write(chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    },
    end(chunk) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      resolveDone(Buffer.concat(chunks));
    },
  };
  return { res, done };
}

describe("downloadTemplate - real catalog, no invented data", () => {
  it("generates an xlsx with a State dropdown, a dependent Article dropdown and a full Article Reference sheet", async () => {
    const creator = new mongoose.Types.ObjectId();
    const article = await Article.create({ stateCode: "KA", articleCode: `TPL-${new mongoose.Types.ObjectId()}`, title: "Template Test Article", description: "Used only for the template test", createdBy: creator, currentVersion: 1 });
    await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "PERCENTAGE", percentage: 3 }, createdBy: creator });

    const req = makeReq({ user: { id: "u", role: Role.SUPER_ADMIN, organizationId: "org-1", permissions: [] } });
    const { res, done } = makeStreamingRes();

    await bulkController.downloadTemplate(req, res, (err) => {
      if (err) throw err;
    });
    const buffer = await done;
    expect(buffer.length).toBeGreaterThan(0);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const templateSheet = workbook.getWorksheet("Template");
    expect(templateSheet).toBeDefined();
    expect(templateSheet.getRow(1).getCell(1).value).toBe("State");
    expect(templateSheet.getRow(1).getCell(2).value).toBe("Article");
    // State dropdown includes the full name, not the raw code.
    const stateValidation = templateSheet.getCell("A2").dataValidation;
    expect(stateValidation.formulae[0]).toContain("Karnataka");
    expect(stateValidation.formulae[0]).not.toContain('"KA"');

    const refSheet = workbook.getWorksheet("Article Reference");
    expect(refSheet).toBeDefined();
    const refRows = [];
    refSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      refRows.push(row.values);
    });
    const match = refRows.find((r) => r[2] === article.articleCode);
    expect(match).toBeDefined();
    expect(match[1]).toBe("Karnataka");
    expect(match[3]).toBe("Template Test Article");
    expect(match[4]).toBe("Used only for the template test");
    expect(match[5]).toBe("3% of consideration price");
  });

  it("round-trips: a filled-in template using full state name and 'code - title' article text uploads successfully", async () => {
    const creator = new mongoose.Types.ObjectId();
    const org = await Organization.create({
      name: "Template Round-Trip Co",
      contactEmail: `tpl-${new mongoose.Types.ObjectId()}@example.com`,
      contactPhone: "9999999999",
      createdBy: creator,
      status: OrganizationStatus.ACTIVE,
      isEstampServiceEnabled: true,
    });
    await Wallet.create({ organizationId: org._id, balance: 100000 });
    const article = await Article.create({ stateCode: "KA", articleCode: `RT-${new mongoose.Types.ObjectId()}`, title: "Round Trip Article", createdBy: creator, currentVersion: 1 });
    await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "FIXED", fixedAmount: 250 }, createdBy: creator });
    const user = await User.create({ name: "Template User", email: `tpluser-${new mongoose.Types.ObjectId()}@ld.local`, passwordHash: "x", role: Role.SUPER_ADMIN, organizationId: org._id });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Template");
    sheet.addRow(["State", "Article", "First Party", "Second Party", "Description of Document", "Property Description", "Consideration Price", "Stamp Duty Paid By", "Number of E-Stamps"]);
    sheet.addRow(["Karnataka", `${article.articleCode} - ${article.title}`, "Alice", "Bob", "Round trip test", "Plot 1", 0, "Alice", 1]);
    const buffer = await workbook.xlsx.writeBuffer();

    const { batch } = await BulkEStampService.uploadBatch({
      organizationId: org._id,
      createdBy: user._id,
      actorRole: Role.SUPER_ADMIN,
      fileBuffer: Buffer.from(buffer),
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      originalFileName: "filled-template.xlsx",
    });

    expect(batch.totalRows).toBe(1);
    const items = await BulkEStampBatchItem.find({ batchId: batch._id }).lean();
    expect(items[0].status).toBe("VALID");
    expect(items[0].inputData.stateCode).toBe("KA");
    expect(items[0].inputData.articleId).toBe(article._id.toString());
    expect(items[0].calculatedAmount).toBe(250);
  });
});
