import {
  buildSep9Payload,
  splitSep9Payload,
  validateSep9Fields,
  SEP9_BINARY_FIELDS,
  type Sep9Fields,
} from "../../src/templates/default/src/lib/sep9";

describe("sep9 (#1054)", () => {
  describe("validateSep9Fields", () => {
    it("accepts a well-formed set of fields", () => {
      const fields: Sep9Fields = {
        first_name: "Jane",
        last_name: "Doe",
        email_address: "jane.doe@example.com",
        birth_date: "1990-05-12",
        sex: "female",
      };

      expect(validateSep9Fields(fields)).toEqual([]);
    });

    it("accepts an empty object (no fields required at this layer)", () => {
      expect(validateSep9Fields({})).toEqual([]);
    });

    it("preserves optional fields that are simply absent", () => {
      const errors = validateSep9Fields({ first_name: "Jane" });
      expect(errors).toEqual([]);
    });

    it("rejects a malformed email_address", () => {
      const errors = validateSep9Fields({ email_address: "not-an-email" });
      expect(errors).toEqual([
        expect.objectContaining({ field: "email_address" }),
      ]);
    });

    it("rejects a malformed birth_date", () => {
      const errors = validateSep9Fields({ birth_date: "05/12/1990" });
      expect(errors).toEqual([
        expect.objectContaining({ field: "birth_date" }),
      ]);
    });

    it("rejects an invalid sex value", () => {
      const errors = validateSep9Fields({
        // Intentionally invalid to exercise the validator.
        sex: "invalid" as Sep9Fields["sex"],
      });
      expect(errors).toEqual([expect.objectContaining({ field: "sex" })]);
    });

    it("rejects a negative organization_number_of_shareholders", () => {
      const errors = validateSep9Fields({
        organization_number_of_shareholders: -1,
      });
      expect(errors).toEqual([
        expect.objectContaining({
          field: "organization_number_of_shareholders",
        }),
      ]);
    });

    it("reports every invalid field at once", () => {
      const errors = validateSep9Fields({
        email_address: "bad",
        birth_date: "bad",
      });
      expect(errors).toHaveLength(2);
    });
  });

  describe("buildSep9Payload", () => {
    it("builds a payload preserving valid fields", () => {
      const payload = buildSep9Payload({
        first_name: "Jane",
        last_name: "Doe",
        email_address: "jane.doe@example.com",
      });

      expect(payload).toEqual({
        first_name: "Jane",
        last_name: "Doe",
        email_address: "jane.doe@example.com",
      });
    });

    it("omits undefined fields", () => {
      const payload = buildSep9Payload({
        first_name: "Jane",
        last_name: undefined,
      });

      expect(payload).toEqual({ first_name: "Jane" });
      expect("last_name" in payload).toBe(false);
    });

    it("omits empty-string fields", () => {
      const payload = buildSep9Payload({
        first_name: "Jane",
        last_name: "",
      });

      expect(payload).toEqual({ first_name: "Jane" });
    });

    it("preserves falsy-but-meaningful values (0)", () => {
      const payload = buildSep9Payload({
        organization_number_of_shareholders: 0,
      });

      expect(payload.organization_number_of_shareholders).toBe(0);
    });

    it("throws when a field fails validation", () => {
      expect(() => buildSep9Payload({ email_address: "not-an-email" })).toThrow(
        /email_address/,
      );
    });

    it("does not mutate the input object", () => {
      const input: Sep9Fields = { first_name: "Jane", last_name: "" };
      const inputCopy = { ...input };

      buildSep9Payload(input);

      expect(input).toEqual(inputCopy);
    });
  });

  describe("splitSep9Payload", () => {
    it("separates string/number fields from binary fields", () => {
      const photo = new Blob(["synthetic-bytes"], { type: "image/png" });
      const payload = buildSep9Payload({
        first_name: "Jane",
        organization_number_of_shareholders: 2,
        photo_id_front: photo,
      });

      const { data, files } = splitSep9Payload(payload);

      expect(data).toEqual({
        first_name: "Jane",
        organization_number_of_shareholders: 2,
      });
      expect(files).toEqual({ photo_id_front: photo });
    });

    it("returns empty data/files for an empty payload", () => {
      const { data, files } = splitSep9Payload({});
      expect(data).toEqual({});
      expect(files).toEqual({});
    });

    it("every SEP9_BINARY_FIELDS entry routes to files, never data", () => {
      const fields: Sep9Fields = {};
      for (const field of SEP9_BINARY_FIELDS) {
        (fields as Record<string, Blob>)[field] = new Blob(["x"]);
      }

      const { data, files } = splitSep9Payload(fields);

      expect(Object.keys(data)).toHaveLength(0);
      expect(Object.keys(files)).toHaveLength(SEP9_BINARY_FIELDS.length);
    });
  });
});
