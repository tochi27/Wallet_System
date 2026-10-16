import sharp from "sharp";
import { decrypt, decryptText, encrypt, encryptText } from "../../../services/kyc/crypto";
import { cleanDocument, DocumentError, MAX_UPLOAD_BYTES } from "../../../services/kyc/documents";

const file = (buffer: Buffer) => ({ buffer, size: buffer.length });

// A real photo with camera details and an EXIF orientation, as a phone would send it
const phonePhoto = (width = 300, height = 200) =>
  sharp({ create: { width, height, channels: 3, background: { r: 120, g: 60, b: 200 } } })
    .withExif({ IFD0: { Make: "PhoneMaker", Model: "Phone X", Copyright: "secret-location-hint" } })
    .jpeg()
    .toBuffer();

describe("kyc crypto", () => {
  it("round-trips a file and an ID number, with a fresh IV each time", () => {
    const plain = Buffer.from("front of my ID card");
    const once = encrypt(plain);
    const twice = encrypt(plain);

    expect(decrypt(once)).toEqual(plain);
    expect(once.equals(twice)).toBe(false);
    expect(once.includes(plain)).toBe(false);
    expect(decryptText(encryptText("12345678901"))).toBe("12345678901");
  });

  it("refuses data that has been tampered with", () => {
    const sealed = encrypt(Buffer.from("front of my ID card"));
    sealed[sealed.length - 1] ^= 0xff;
    expect(() => decrypt(sealed)).toThrow();
  });
});

describe("cleanDocument", () => {
  it("re-encodes photos as JPEG and strips the camera details", async () => {
    const original = await phonePhoto();
    expect((await sharp(original).metadata()).exif).toBeDefined();

    const doc = await cleanDocument("ID_FRONT", file(original));

    expect(doc.mimeType).toBe("image/jpeg");
    const meta = await sharp(doc.data).metadata();
    expect(meta.exif).toBeUndefined();
    expect(doc.data.includes(Buffer.from("PhoneMaker"))).toBe(false);
    expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("shrinks large photos to at most 2000px", async () => {
    const doc = await cleanDocument("SELFIE", file(await phonePhoto(4000, 3000)));
    const { width, height } = await sharp(doc.data).metadata();
    expect(Math.max(width!, height!)).toBe(2000);
  });

  it("accepts PNG and turns it into JPEG", async () => {
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: "white" } }).png().toBuffer();
    expect((await cleanDocument("ID_BACK", file(png))).mimeType).toBe("image/jpeg");
  });

  it("keeps a PDF as it is for an ID, but not for the selfie", async () => {
    const pdf = Buffer.from("%PDF-1.4\n% a scanned NIN slip\n");
    const doc = await cleanDocument("ID_FRONT", file(pdf));
    expect(doc.mimeType).toBe("application/pdf");
    expect(doc.data).toEqual(pdf);

    await expect(cleanDocument("SELFIE", file(pdf))).rejects.toThrow("must be a photo");
  });

  it("decides the type from the file's contents, not its name", async () => {
    const script = Buffer.from("<script>alert(1)</script>");
    await expect(cleanDocument("ID_FRONT", file(script))).rejects.toBeInstanceOf(DocumentError);
  });

  it("rejects a file that claims to be a JPEG but isn't one", async () => {
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("not really an image")]);
    await expect(cleanDocument("ID_FRONT", file(fake))).rejects.toThrow("couldn't be read");
  });

  it("rejects files over 5 MB", async () => {
    await expect(cleanDocument("ID_FRONT", { buffer: Buffer.alloc(10), size: MAX_UPLOAD_BYTES + 1 })).rejects.toThrow("over 5 MB");
  });
});
