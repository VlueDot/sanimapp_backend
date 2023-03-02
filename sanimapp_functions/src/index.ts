import * as functions from "firebase-functions";
import * as OdooFcn from "./Odoo_utils";
import * as FirebaseFcn from "./Firebase_utils";
import * as admin from "firebase-admin";

// Firebase Connection Settings
const serviceAccount = require("./service-account.json");
export const urldatabase = "https://sanimappdev-default-rtdb.firebaseio.com";
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: urldatabase,
});



// Functions

export const TestFunction = functions.https.onRequest( async (request, response) => {
  // do here whatever you must
  try {
    const odoo_session = await OdooFcn.odoo_Login();

    if (odoo_session != null) {
      // await OdooFcn.odooToFirebase_CRM_Tickets(odoo_session);

      await OdooFcn.odoo_Logout(odoo_session);
    }


    response.send("OdooSync End");
  } catch (error) {
    functions.logger.error(error);

    response.send("OdooSync Error: "+error);
  }
});


export const OdooToFirebase = functions.https.onRequest(async (request, response)=> {
  // this will run with certain periodicity. This will be the stable function.
  // Here will be everything at the moment. eventually we will separate them to test each one of these.
  try {
    const odoo_session = await OdooFcn.odoo_Login();

    if (odoo_session != null) {
      await OdooFcn.odooToFirebase_CRM_Campaigns(odoo_session);

      await OdooFcn.odoo_Logout(odoo_session);
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


export const firebaseToOdoo_Stops_update = functions.database
.ref("/test2/stops/{idStopFb}")
.onUpdate( async (change, context)=>{
  let partnerIds_before = change.before.val()
  let partnerIds_after = change.after.val()
  


  if (partnerIds_before === partnerIds_after) return null;

  else {

    let partnerIds_deleted = []
    let partnerIds_added = []
    let partnerIds_after_array = []


    for(let index in partnerIds_before["partnersId"]){

      if(index in partnerIds_after["partnersId"]) continue
      else partnerIds_deleted.push(index)
    }

    for(let index in partnerIds_after["partnersId"]){
      partnerIds_after_array.push(Number(index))
      if(index in partnerIds_before["partnersId"]) continue
      else partnerIds_added.push(index)

    }

    functions.logger.info("[firebaseToOdoo_Stops_update]: Stops will update partners in odoo.", {"idStopFb": context.params.idStopFb, "Deleted": JSON.stringify(partnerIds_deleted), "Added": JSON.stringify(partnerIds_added)})


    //obten el json y envialo a odoo
    //primero tengo que estar logeado
    const odoo_session = await OdooFcn.odoo_Login();
    if (odoo_session != null) {

      await OdooFcn.FirebaseToOdoo_ChangeStopsRoutesLabels(odoo_session, Number(partnerIds_after["idOdoo"]), partnerIds_after_array);
      await OdooFcn.odoo_Logout(odoo_session);
      return true;
    }
    //si la respuesta del servidor es afirmativa devuelve un ok. Sino regresa el valor original y manda error
    return null;
  }
});


// export const firebaseToOdoo_Routes_update = functions.database
// .ref("/test/Route_definition")
// .onWrite( async (change)=>{

//   console.log(change.after.val());

//   if (change.after.val() === change.before.val()) return null;

//   else {

//     //obten el json y envialo a odoo
//     //primero tengo que estar logeado
//     const odoo_session = await OdooFcn.odoo_Login();
//     const res = OdooFcn.FirebaseToOdoo_ChangeStopsRoutesLabels(odoo_session, change.after.val())

//     //si la respuesta del servidor es afirmativa devuelve un ok. Sino regresa el valor original y manda error
//     return res;
//   }
// });
