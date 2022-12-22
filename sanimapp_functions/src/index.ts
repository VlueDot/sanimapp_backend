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
  try{
    let odoo_login = await Odoo.OdooLogin();
    functions.logger.info("Odoo Login: " + odoo_login);
    let odoo_logout = await Odoo.OdooLogout()
    functions.logger.info("Odoo Logout: " + odoo_logout);
  }
  catch(error)
  {
    functions.logger.info("Odoo Error: " + error);
    response.send("OdooSync failed " + error)
  }
  
  response.send("OdooSync")
  
})




