import * as functions from "firebase-functions";
import * as OdooFcn from "./Odoo_utils";
import * as FirebaseFcn from "./Firebase_utils";
import * as admin from "firebase-admin";

// Firebase Connection Settings
import * as serviceAccount from "../service-account.json";
export const urldatabase = "https://" + serviceAccount.project_id +"-default-rtdb.firebaseio.com";
admin.initializeApp({
  credential: admin.credential.cert(String(serviceAccount)),
  databaseURL: urldatabase,
});


// Functions

export const TestFunction = functions.https.onRequest( async (request, response) => {
  // do here whatever you must
  try {
    const odoo_session = await OdooFcn.odoo_Login();

    if (odoo_session != null) {
      await OdooFcn.odooToFirebase_CRM_Tickets(odoo_session);

      await OdooFcn.odoo_Logout();
    }

    response.send("OdooSync End");
  } catch (error) {
    functions.logger.error(error);

    response.send("OdooSync Error: "+error);
  }
  
});


// export const OdooSync = functions.https.onRequest(async (request, response)=> {
//   // this will run with certain periodicity. This will be the stable function.
//   try {
//     const odoo_login = await OdooFcn.odoo_Login();


//     if (odoo_login != 0) OdooFcn.odoo_Logout();

//     response.send("OdooSync Finished Successfully");
//   } catch (error) {
//     functions.logger.error(error);

//     response.send("OdooSync Error: "+error);
//   }
// });

export const OdooToFirebase = functions.https.onRequest(async (request, response)=> {
  // this will run with certain periodicity. This will be the stable function.
  try {
    const odoo_session = await OdooFcn.odoo_Login();

    if (odoo_session != null) {
      await OdooFcn.odooToFirebase_CRM_Campaigns(odoo_session);

      await OdooFcn.odoo_Logout();
    }

    response.send("OdooSync End");
  } catch (error) {
    functions.logger.error(error);

    response.send("OdooSync Error: "+error);
  }
});


export const firebaseToOdoo_CRM = functions.database
    .ref("/test")
    .onWrite( async (change)=>{
      if (change.after.val() === change.before.val()) return null;

      else {
        const res = FirebaseFcn.updateCRMOdoo(change);
        return res;
      }
    });


