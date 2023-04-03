import * as functions from "firebase-functions";
import * as OdooFcn from "./Odoo_utils";
import * as FirebaseFcn from "./Firebase_utils";
import * as admin from "firebase-admin";

// FROM FIREBASE TO ODOO
export let firebaseToOdoo_Stops_update : any; // [IN PRODUCTION] if stops change in firebase, updates partner's tag in odoo
export let firebaseToOdoo_Routes_update : any;// [IN PRODUCTION] if Route change in firebase, updates partner's tag in odoo
export let firebaseToOdoo_Stops_create : any;// [IN PRODUCTION] if stop is created in firebase, creates the tag in odoo
export let firebaseToOdoo_Routes_create : any;// [IN PRODUCTION] if Route is created in firebase, creates the tag in odoo
export let firebaseToOdoo_User_inactive: any;

// FROM ODOO TO FIREBASE
export let odooToFirebase : any;// if users or ticket changed in odoo, it changes it in firebase

// TRIGGERS INSIDE FIREBASE
export let firebase_Stops_UsersQuantity_update : any;// [IN PRODUCTION] it stops changed, it updates users_quantity if necesary

// Firebase Connection Settings
const serviceAccount = require("./service-account.json");
export const urldatabase = "https://sanimappdev-default-rtdb.firebaseio.com";
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: urldatabase,
});

// FUNCTIONS

// testFunction = functions.https.onRequest( async (request, response) => {
//   // do here whatever you must
//   try {
//     const odoo_session = await OdooFcn.odoo_Login();

//     if (odoo_session != null) {
//       // await OdooFcn.odooToFirebase_CRM_Tickets(odoo_session);

//       await OdooFcn.odoo_Logout(odoo_session);
//     }


//     response.send("OdooSync End: " + odoo_session);
//   } catch (error) {
//     functions.logger.error(error);

//     response.send("OdooSync Error: "+error);
//   }
// });

// odooToFirebase = functions.https.onRequest(async (request, response)=> {
//   // this will run with certain periodicity. This will be the stable function.
//   // Here will be everything at the moment. eventually we will separate them to test each one of these.
//   try {
//     const odoo_session = await OdooFcn.odoo_Login();

//     if (odoo_session != null) {
//       await OdooFcn.odooToFirebase_CRM_Campaigns(odoo_session);

//       await OdooFcn.odoo_Logout(odoo_session);
//     }

//     response.send("OdooSync End");
//   } catch (error) {
//     functions.logger.error(error);

//     response.send("OdooSync Error: "+error);
//   }
// });

// firebaseToOdoo_CRM = functions.database.ref("/test").onWrite( async (change)=>{
//   if (change.after.val() === change.before.val()) return null;

//   else {
//     const res = FirebaseFcn.updateCRMOdoo(change);
//     return res;
//   }
// });

firebase_Stops_UsersQuantity_update = functions.database.ref("stops/{idStopFb}").onUpdate( async (change, context)=>{
  const stopData_before = change.before.val();
  const stopData_after = change.after.val();
  const idFirebase = context.params.idStopFb;

  let usersQuantity_before : number;
  let usersQuantity_after : number;

  let dict_before = {};
  dict_before = stopData_before["Users_quantity"];
  if (dict_before != undefined) {
    usersQuantity_before = Number(dict_before);
  } else {
    usersQuantity_before = -1;
    console.log("info", "No Users_quantity in Firebase");
  }

  let dict_after = {};
  dict_after = stopData_after["partnersId"];
  if (dict_after != undefined) {
    usersQuantity_after = Object.keys(stopData_after["partnersId"]).length;
    // console.log("users after", usersQuantity_after);
  } else {
    usersQuantity_after = 0;
  }

  if (usersQuantity_before === usersQuantity_after) return null;
  else {
    FirebaseFcn.firebaseSet("stops/" + idFirebase + "/Users_quantity", usersQuantity_after);
    functions.logger.info("[firebase_Stops_UsersQuantity_update]: Stop users quantity will be updated.", {"idStopFb": context.params.idStopFb, "Old Users Quantity": usersQuantity_before, "New Users Quantity": usersQuantity_after});
    return true;
  }
});

firebaseToOdoo_Stops_update = functions.database.ref("stops/{idStopFb}").onUpdate( async (change, context)=>{
  const partnerIds_before = change.before.val();
  const partnerIds_after = change.after.val();
  let borrar = false;
  let llenar = false;
  console.log("tst 777");
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
      // console.log("list_after", list_after);
    } else {
      list_after = [];
      borrar = true;
    }

    dict_before = partnerIds_before["partnersId"];
    if (dict_before != undefined) {
      list_before = Object.keys(dict_before);
      // console.log("list_before", list_before);
    } else {
      list_before = [];
      llenar = true;
    }

    // console.log("borrar", borrar);
    // console.log("llenar", llenar);

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

    const odoo_session = await OdooFcn.odoo_Login();
    if (odoo_session != null) {
      const lastupdateTimestamp = Date.now();
      const odooWrite = await OdooFcn.verifyIfodooWriteInFirebase(odoo_session, partnerIds_after["idOdoo"], lastupdateTimestamp);

      if (!odooWrite) {
        functions.logger.info("[firebaseToOdoo_Stops_update]: Stops will update partners in odoo.", {"idRouteFb": context.params.idStopFb, "Deleted": JSON.stringify(partnerIds_deleted), "Added": JSON.stringify(partnerIds_added)});
        await OdooFcn.firebaseToOdoo_ChangeStopsRoutesLabels(odoo_session, Number(partnerIds_after["idOdoo"]), partnerIds_after_array);
        if (borrar) await OdooFcn.firebaseToOdoo_DeleteStopLabels(odoo_session, Number(partnerIds_after["idOdoo"]), partnerIds_after_array[0]);
      } else functions.logger.info("[firebaseToOdoo_Stops_update]: Odoo write in Firebase. Doing nothing");

      await OdooFcn.odoo_Logout(odoo_session);
      return true;
    }
    return null;
  }
});

firebaseToOdoo_Routes_update = functions.database.ref("/Route_definition/{idRouteFb}").onUpdate( async (change, context)=>{
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
      // console.log("list_after", list_after);
    } else {
      list_after = [];
      borrar = true;
    }

    dict_before = partnerIds_before["partnersId"];
    if (dict_before != undefined) {
      list_before = Object.keys(dict_before);
      // console.log("list_before", list_before);
    } else {
      list_before = [];
      llenar = true;
    }

    // console.log("borrar", borrar);
    // console.log("llenar", llenar);

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

firebaseToOdoo_Stops_create = functions.database.ref("/stops/{idStopFb}").onCreate( async (change, context)=>{
  const partnersId_new = change.val();

  const partnerIds_toCreate : Array<number> = [];

  let list : Array<string>;
  let dict = {};

  dict = partnersId_new["partnersId"];
  if (dict != undefined) {
    list = Object.keys(dict);
    // console.log("list_after", list);
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

firebaseToOdoo_Routes_create = functions.database.ref("/Route_definition/{idRouteFb}").onCreate( async (change, context)=>{
  const partnersId_new = change.val();

  const partnerIds_toCreate = [];

  let list : Array<string>;
  let dict = {};

  dict = partnersId_new["partnersId"];
  if (dict != undefined) {
    list = Object.keys(dict);
    // console.log("list_after", list);
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

odooToFirebase = functions.https.onRequest(async (request, response)=> {
// odooToFirebase_updateUser = functions.pubsub.schedule("every minute")
//     .timeZone("America/Lima")
//     .onRun(async () =>{
  // this will run with certain periodicity. This will be the stable function.
  // Here will be everything at the moment. eventually we will separate them to test each one of these.

  try {
    const lastupdateTimestamp_users = await FirebaseFcn.firebaseGet("/timestamp_collection/ussersTimeStamp");
    const lastupdateTimestamp_tickets = await FirebaseFcn.firebaseGet("/timestamp_collection/tickets_timestamp");
    const lastupdateTimestamp_crm = await FirebaseFcn.firebaseGet("/timestamp_collection/CMR_tickets_timestamp");

    const odoo_session = await OdooFcn.odoo_Login();

    if (odoo_session != null) {
      // await OdooFcn.odooToFirebase_Users(odoo_session, lastupdateTimestamp_users);
      // await OdooFcn.odooToFirebase_ServiceTickets(odoo_session, lastupdateTimestamp_tickets);
      const init = Number(Date.now());
      console.log("inicio");

      await OdooFcn.odooToFirebase_all(odoo_session, lastupdateTimestamp_users, lastupdateTimestamp_tickets, lastupdateTimestamp_crm);

      const final = Number(Date.now());
      console.log("tiempo", final - init);

      await OdooFcn.odoo_Logout(odoo_session);
    }

    response.send("odooToFirebase. odoo_session: .." + odoo_session?.substring(odoo_session.length - 5));

    // return true;
  } catch (error) {
    functions.logger.error( "[odooToFirebase] ERROR at Start. ", error);
    response.send("OdooSync Error: "+error);
    // return false;
  }
});

firebaseToOdoo_User_inactive = functions.database.ref("/Data_client/{idUserFb}").onUpdate(async (change, context) => {
  const client_before = change.before.val();
  const client_after = change.after.val();
  console.log("tst - 777");

  const Client_Type_old = client_before["Data_client_2"]["Client_Type"];
  const client_type_old = client_before["Data_client_3"]["client_type"];

  const Client_Type_new = client_after["Data_client_2"]["Client_Type"];
  const client_type_new = client_after["Data_client_3"]["client_type"];

  if ((Client_Type_old != Client_Type_new) || (client_type_old != client_type_new)) {
    if ((client_type_new === "Cliente desinstalado") && (Client_Type_new === "Cliente desinstalado")) {
      const odoo_session = await OdooFcn.odoo_Login();
      await OdooFcn.firebaseToOdoo_PutInactiveTag(odoo_session, Number(context.params.idUserFb));
      functions.logger.info("[firebaseToOdoo_User_inactive]: The client will be set to <inactivo> tag.", {
        "idUserFb": context.params.idUserFb,
        "Client_Type_old": Client_Type_old,
        "client_type_old": client_type_old,
        "Client_Type_new": Client_Type_new,
        "client_type_new": client_type_new,
      });
      await OdooFcn.odoo_Logout(odoo_session);
      return null;
    }
  }

  if (client_type_new != Client_Type_new) {
    functions.logger.error("[firebaseToOdoo_User_inactive]: Client type diferente between Data_client_2 and Data_client_3.", {
      "idUserFb": context.params.idUserFb,
      "Client_Type_old": Client_Type_old,
      "client_type_old": client_type_old,
      "Client_Type_new": Client_Type_new,
      "client_type_new": client_type_new,
    });
  }

  return null;
});
