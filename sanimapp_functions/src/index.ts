import * as functions from "firebase-functions";
import * as Odoo from "./Odoo_utils";
// import { Firebase_utils } from "./Firebase_utils";

// // Start writing functions
// // https://firebase.google.com/docs/functions/typescript
//
export const helloWorld = functions.https.onRequest((request, response) => {
  functions.logger.info("Hello logs!", {structuredData: true});
  response.send("Hello from Firebase!");
});

export const OdooSync = functions.https.onRequest(async (request, response)=> {
  await Odoo.OdooLogin();
  response.send("Odoo login!");
})




