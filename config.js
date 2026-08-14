// Hoof Records 2.5 release configuration.
// IT can review medicine defaults and storage identifiers here without searching app.js.
window.HOOF_RECORDS_CONFIG = Object.freeze({
  appVersion: "2.5",
  dataSchemaVersion: 1,

  storageKeys: Object.freeze({
    records: "hoofRecordsV2Records",
    sessions: "hoofRecordsV2Sessions",
    active: "hoofRecordsV2ActiveSession",
    schema: "hoofRecordsDataSchemaVersion"
  }),

  photoDb: Object.freeze({
    name: "hoofRecordsPhotos",
    version: 1,
    store: "photos"
  }),

  photos: Object.freeze({
    maxPerCow: 3,
    maxLongSide: 1800,
    jpegQuality: 0.86
  }),

  brand: Object.freeze({
    logoUrl: "./vetlife-logo.jpg",
    logoWidth: 295,
    logoHeight: 128,
    lightBrown: "#a79075",
    darkBrown: "#5c4b3a"
  }),

  medicines: Object.freeze({
    nsaid: Object.freeze({
      "Metacam": Object.freeze({
        milk: Object.freeze({ value: 84, unit: "hours" }),
        meat: Object.freeze({ value: 10, unit: "days" })
      }),
      "Key 10%": Object.freeze({
        milk: Object.freeze({ value: 0, unit: "hours" }),
        meat: Object.freeze({ value: 4, unit: "days" })
      })
    }),
    antibiotic: Object.freeze({
      "Intracillin 300": Object.freeze({
        milk: Object.freeze({ value: 96, unit: "hours" }),
        meat: Object.freeze({ value: 10, unit: "days" })
      }),
      "Depocillin": Object.freeze({
        milk: Object.freeze({ value: 108, unit: "hours" }),
        meat: Object.freeze({ value: 10, unit: "days" })
      })
    })
  })
});
