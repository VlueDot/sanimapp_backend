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

export const testFunction = functions.https.onRequest( async (request, response) => {
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

export const odooToFirebase = functions.https.onRequest(async (request, response)=> {
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

export const firebaseToOdoo_CRM = functions.database.ref("/test").onWrite( async (change)=>{
  if (change.after.val() === change.before.val()) return null;

  else {
    const res = FirebaseFcn.updateCRMOdoo(change);
    return res;
  }
});

export const firebaseToOdoo_Stops_update = functions.database.ref("stops/{idStopFb}").onUpdate( async (change, context)=>{
  const partnerIds_before = change.before.val();
  const partnerIds_after = change.after.val();
  let borrar = false;
  let llenar = false;

  if (partnerIds_before === partnerIds_after) return null;
  else {
    const partnerIds_deleted = [];
    const partnerIds_added = [];
    const partnerIds_after_array = [];

    let dict_before = {};
    let dict_after = {};

    let list_after : Array<string>;
    let list_before : Array<string>;

    dict_after = partnerIds_after["partnersId"];
    if (dict_after != undefined) {
      list_after = Object.keys(dict_after);
      console.log("list_after", list_after);
    } else {
      list_after = [];
      borrar = true;
    }

    dict_before = partnerIds_before["partnersId"];
    if (dict_before != undefined) {
      list_before = Object.keys(dict_before);
      console.log("list_before", list_before);
    } else {
      list_before = [];
      llenar = true;
    }

    console.log("borrar", borrar);
    console.log("llenar", llenar);

    for (let i = 0; i < list_before.length; i++) {
      const index = list_before[i];
      if (list_after.includes(index)) continue;
      else partnerIds_deleted.push(index);
    }

    for (let i = 0; i < list_after.length; i++) {
      const index = list_after[i];
      partnerIds_after_array.push(Number(index));
      if (list_before.includes(index)) continue;
      else partnerIds_added.push(index);
    }

    if (borrar && !llenar) partnerIds_after_array.push(Number(partnerIds_deleted[0]));

    functions.logger.info("[firebaseToOdoo_Stops_update]: Stops will update partners in odoo.", {"idRouteFb": context.params.idStopFb, "Deleted": JSON.stringify(partnerIds_deleted), "Added": JSON.stringify(partnerIds_added)});

    const odoo_session = await OdooFcn.odoo_Login();
    if (odoo_session != null) {
      await OdooFcn.firebaseToOdoo_ChangeStopsRoutesLabels(odoo_session, Number(partnerIds_after["idOdoo"]), partnerIds_after_array);
      if (borrar) {
        await OdooFcn.firebaseToOdoo_DeleteStopLabels(odoo_session, Number(partnerIds_after["idOdoo"]), partnerIds_after_array[0]);
      }
      await OdooFcn.odoo_Logout(odoo_session);
      return true;
    }
    return null;
  }
});

export const firebaseToOdoo_Routes_update = functions.database.ref("/Route_definition/{idRouteFb}").onUpdate( async (change, context)=>{
  const partnerIds_before = change.before.val();
  const partnerIds_after = change.after.val();
  let borrar = false;
  let llenar = false;

  if (partnerIds_before === partnerIds_after) return null;
  else {
    const partnerIds_deleted = [];
    const partnerIds_added = [];
    const partnerIds_after_array = [];

    let dict_before = {};
    let dict_after = {};

    let list_after : Array<string>;
    let list_before : Array<string>;

    dict_after = partnerIds_after["partnersId"];
    if (dict_after != undefined) {
      list_after = Object.keys(dict_after);
      console.log("list_after", list_after);
    } else {
      list_after = [];
      borrar = true;
    }

    dict_before = partnerIds_before["partnersId"];
    if (dict_before != undefined) {
      list_before = Object.keys(dict_before);
      console.log("list_before", list_before);
    } else {
      list_before = [];
      llenar = true;
    }

    console.log("borrar", borrar);
    console.log("llenar", llenar);

    for (let i = 0; i < list_before.length; i++) {
      const index = list_before[i];
      if (list_after.includes(index)) continue;
      else partnerIds_deleted.push(index);
    }

    for (let i = 0; i < list_after.length; i++) {
      const index = list_after[i];
      partnerIds_after_array.push(Number(index));
      if (list_before.includes(index)) continue;
      else partnerIds_added.push(index);
    }

    if (borrar && !llenar) partnerIds_after_array.push(Number(partnerIds_deleted[0]));

    functions.logger.info("[firebaseToOdoo_Routes_update]: Routes will update partners in odoo.", {"idRouteFb": context.params.idRouteFb, "Deleted": JSON.stringify(partnerIds_deleted), "Added": JSON.stringify(partnerIds_added)});

    const odoo_session = await OdooFcn.odoo_Login();
    if (odoo_session != null) {
      await OdooFcn.firebaseToOdoo_ChangeStopsRoutesLabels(odoo_session, Number(partnerIds_after["idOdoo"]), partnerIds_after_array);
      if (borrar && !llenar) {
        await OdooFcn.firebaseToOdoo_DeleteStopLabels(odoo_session, Number(partnerIds_after["idOdoo"]), partnerIds_after_array[0]);
      }
      await OdooFcn.odoo_Logout(odoo_session);
      return true;
    }
    // si la respuesta del servidor es afirmativa devuelve un ok. Sino regresa el valor original y manda error
    return null;
  }
});

export const firebaseToOdoo_Stops_create = functions.database.ref("stops/{idStopFb}").onCreate( async (change, context)=>{
  const partnersId_new = change.val();

  const partnerIds_toCreate : Array<number> = [];

  let list : Array<string>;
  let dict = {};

  dict = partnersId_new["partnersId"];
  if (dict != undefined) {
    list = Object.keys(dict);
    console.log("list_after", list);
    for (let i = 0; i < list.length; i++) {
      const index = Number(list[i]);
      partnerIds_toCreate.push(index);
    }
  } else {
    list = [];
  }

  const idFirebase = context.params.idStopFb;

  functions.logger.info("[firebaseToOdoo_Stops_create]: Stops will be created with partners in odoo.", {"idStopFb": idFirebase, "Created": JSON.stringify(partnerIds_toCreate)});

  const odoo_session = await OdooFcn.odoo_Login();
  if (odoo_session != null) {
    const idOdoo = await OdooFcn.firebaseToOdoo_CreateStopsRoutesLabels(odoo_session, partnersId_new["Stops_name"], partnerIds_toCreate);
    await OdooFcn.odoo_Logout(odoo_session);
    FirebaseFcn.firebaseSet("stops/" + idFirebase + "/idOdoo", idOdoo);
    return true;
  }
  // si la respuesta del servidor es afirmativa devuelve un ok. Sino regresa el valor original y manda error
  return null;
});

export const firebaseToOdoo_Routes_create = functions.database.ref("/Route_definition/{idRouteFb}").onCreate( async (change, context)=>{
  const partnersId_new = change.val();

  const partnerIds_toCreate = [];

  let list : Array<string>;
  let dict = {};

  dict = partnersId_new["partnersId"];
  if (dict != undefined) {
    list = Object.keys(dict);
    console.log("list_after", list);
    for (let i = 0; i < list.length; i++) {
      const index = Number(list[i]);
      partnerIds_toCreate.push(index);
    }
  } else {
    list = [];
  }

  const idFirebase = context.params.idRouteFb;

  functions.logger.info("[firebaseToOdoo_Routes_create]: Routes will be created with partners in odoo.", {"idStopFb": idFirebase, "Created": JSON.stringify(partnerIds_toCreate)});

  const odoo_session = await OdooFcn.odoo_Login();
  if (odoo_session != null) {
    const idOdoo = await OdooFcn.firebaseToOdoo_CreateStopsRoutesLabels(odoo_session, partnersId_new["Nom_ruta"], partnerIds_toCreate);
    await OdooFcn.odoo_Logout(odoo_session);
    FirebaseFcn.firebaseSet("Route_definition/" + idFirebase + "/idOdoo", idOdoo);
    return true;
  }
  // si la respuesta del servidor es afirmativa devuelve un ok. Sino regresa el valor original y manda error
  return null;
});
//     //si la respuesta del servidor es afirmativa devuelve un ok. Sino regresa el valor original y manda error
//     return res;
//   }
// });


export const odooToFirebase_updateUser = functions.https.onRequest(async (request, response)=> {
  // this will run with certain periodicity. This will be the stable function.
  // Here will be everything at the moment. eventually we will separate them to test each one of these.
  try {
    const lastupdateTimestamp = await FirebaseFcn.firebaseGet("/timestamp_collection/ussersTimeStamp");


    const odoo_session = await OdooFcn.odoo_Login();

    if (odoo_session != null) {
      await OdooFcn.odooToFirebase_Users(odoo_session, lastupdateTimestamp);

      await OdooFcn.odoo_Logout(odoo_session);
    }

    response.send("OdooSync End");
  } catch (error) {
    functions.logger.error(error);

    response.send("OdooSync Error: "+error);
  }
});
