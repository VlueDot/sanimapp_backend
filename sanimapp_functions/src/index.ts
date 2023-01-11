import * as functions from "firebase-functions";
import * as OdooFcn from "./Odoo_utils";
import * as FirebaseFcn from "./Firebase_utils";
import * as admin from "firebase-admin";


//Firebase Connection Settings
const serviceAccount = require("../service-account.json");
export const urldatabase = "https://" + serviceAccount.project_id +"-default-rtdb.firebaseio.com";
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: urldatabase,
});


//Functions

export const TestFunction = functions.https.onRequest( (request,response) => {
  //do here whatever you must

  response.send("TestFunction Finished")
  
})


export const OdooSync = functions.https.onRequest(async (request, response)=> {
  //this will run with certain periodicity. This will be the stable function. 
  try{
    let odoo_login = await OdooFcn.OdooLogin();

    

    if (odoo_login == 1) OdooFcn.OdooLogout()

    response.send("OdooSync Finished Successfully")
  
  }
  catch(error)
  {
    functions.logger.error(error);

    response.send("OdooSync Error: "+error)
    
  }
  
})


export const FirebaseToOdoo_CRM = functions.database
    .ref("/test")
    .onWrite( async (change)=>{
      if (change.after.val() === change.before.val()) return null;

      else {
        let res = FirebaseFcn.updateCRM_Odoo(change)
        return res}
    });




