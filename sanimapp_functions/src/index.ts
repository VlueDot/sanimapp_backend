import * as functions from "firebase-functions";
import * as OdooFcn from "./Odoo_utils";
import * as FirebaseFcn from "./Firebase_utils";
import * as admin from "firebase-admin";

// FROM FIREBASE TO ODOO
export let firebaseToOdoo_Stops_update : any; // [IN PRODUCTION] if stops change in firebase, updates partner's tag in odoo
export let firebaseToOdoo_Routes_update : any;// [IN PRODUCTION] if Route change in firebase, updates partner's tag in odoo
export let firebaseToOdoo_Stops_create : any;// [IN PRODUCTION] if stop is created in firebase, creates the tag in odoo
export let firebaseToOdoo_Routes_create : any;// [IN PRODUCTION] if Route is created in firebase, creates the tag in odoo
export let firebaseToOdoo_UserTags_update: any;

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
    // console.log("info", "No Users_quantity in Firebase");
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
        functions.logger.info("[firebaseToOdoo_Stops_update]: Stops will update partners in odoo.", {
          "odoo_session": odoo_session,
          "stop_name": partnerIds_after["Stops_name"],
          "stop_id_firebase": context.params.idStopFb,
          "stop_id_odoo": partnerIds_after["idOdoo"],
          "initialState": JSON.stringify(list_before),
          "targetState": JSON.stringify(partnerIds_after_array),
          "users_deleted": JSON.stringify(partnerIds_deleted),
          "users_added": JSON.stringify(partnerIds_added),
        });
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

    const odoo_session = await OdooFcn.odoo_Login();
    if (odoo_session != null) {
      await OdooFcn.firebaseToOdoo_ChangeStopsRoutesLabels(odoo_session, Number(partnerIds_after["idOdoo"]), partnerIds_after_array);
      functions.logger.info("[firebaseToOdoo_Routes_update]: Routes will update partners in odoo.", {
        "odoo_session": odoo_session,
        "route_name": partnerIds_after["Nom_ruta"],
        "route_id_firebase": context.params.idRouteFb,
        "route_id_odoo": partnerIds_after["idOdoo"],
        "initialState": JSON.stringify(list_before),
        "targetState": JSON.stringify(partnerIds_after_array),
        "users_deleted": JSON.stringify(partnerIds_deleted),
        "users_added": JSON.stringify(partnerIds_added),
      });
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

  const odoo_session = await OdooFcn.odoo_Login();
  if (odoo_session != null) {
    const idOdoo = await OdooFcn.firebaseToOdoo_CreateStopsRoutesLabels(odoo_session, partnersId_new["Stops_name"], partnerIds_toCreate);
    await OdooFcn.odoo_Logout(odoo_session);
    FirebaseFcn.firebaseSet("stops/" + idFirebase + "/idOdoo", idOdoo);
    functions.logger.info("[firebaseToOdoo_Stops_create]: Stop created with partners in odoo.", {
      "odoo_session": odoo_session,
      "stop_name": partnersId_new["Stops_name"],
      "stop_id_firebase": context.params.idStopFb,
      "stop_id_odoo": idOdoo,
      "users_to_assign": JSON.stringify(partnerIds_toCreate),
    });
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

  const odoo_session = await OdooFcn.odoo_Login();
  if (odoo_session != null) {
    const idOdoo = await OdooFcn.firebaseToOdoo_CreateStopsRoutesLabels(odoo_session, partnersId_new["Nom_ruta"], partnerIds_toCreate);
    await OdooFcn.odoo_Logout(odoo_session);
    FirebaseFcn.firebaseSet("Route_definition/" + idFirebase + "/idOdoo", idOdoo);
    functions.logger.info("[firebaseToOdoo_Routes_create]: Route created with partners in odoo.", {
      "route_name": partnersId_new["Nom_ruta"],
      "route_id_firebase": idFirebase,
      "route_id_odoo": idOdoo,
      "users_to_assign": JSON.stringify(partnerIds_toCreate),
    });

    return true;
  }
  // si la respuesta del servidor es afirmativa devuelve un ok. Sino regresa el valor original y manda error
  return null;
});

// odooToFirebase = functions.https.onRequest(async (request, response)=> {
odooToFirebase = functions.pubsub.schedule("every minute")
    .timeZone("America/Lima")
    .onRun(async () =>{
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
          // const init = Number(Date.now());
          // console.log("inicio");

          await OdooFcn.odooToFirebase_all(odoo_session, lastupdateTimestamp_users, lastupdateTimestamp_tickets, lastupdateTimestamp_crm);

          // const final = Number(Date.now());
          // console.log("tiempo", final - init);

          await OdooFcn.odoo_Logout(odoo_session);
        }

        // response.send("odooToFirebase. odoo_session: .." + odoo_session?.substring(odoo_session.length - 5));
        return true;
      } catch (error) {
        functions.logger.error( "[odooToFirebase] ERROR at Start. ", error);
        // response.send("OdooSync Error: "+error);
        return false;
      }
    });

firebaseToOdoo_UserTags_update = functions.database.ref("/Data_client/{idUserFb}").onUpdate(async (change, context) => {
  const user_id = Number(context.params.idUserFb);
  const listOfActives = ["Cliente Nuevo", "Cliente suspendido", "Cliente por llamar", "Cliente piloto", "Cliente normal", "Cliente gold"];

  const client_before = change.before.val();
  const client_after = change.after.val();

  const Client_Type_old = client_before["Data_client_2"]["Client_Type"];
  const client_type_old = client_before["Data_client_3"]["client_type"];

  const Client_Type_new = client_after["Data_client_2"]["Client_Type"];
  const client_type_new = client_after["Data_client_3"]["client_type"];

  if ((Client_Type_old != Client_Type_new) || (client_type_old != client_type_new)) {
    if (Client_Type_new === client_type_new) {
      if ((client_type_new === "Cliente desinstalado") && (Client_Type_new === "Cliente desinstalado")) {
        const odoo_session = await OdooFcn.odoo_Login();

        await OdooFcn.firebaseToOdoo_PutInactiveTag(odoo_session, user_id);
        functions.logger.info("[firebaseToOdoo_UserTags_update]: The client "+ user_id+" will be set to <inactivo> tag.", {
          "odoo_session": odoo_session,
          "user_id": user_id,
          "Client_Type_old": Client_Type_old,
          "client_type_old": client_type_old,
          "Client_Type_new": Client_Type_new,
          "client_type_new": client_type_new,
        });
        await OdooFcn.odoo_Logout(odoo_session);
        return null;
      }

      if ((client_type_new === "Cliente por instalar") && (Client_Type_new === "Cliente por instalar")) {
        const odoo_session = await OdooFcn.odoo_Login();
        await OdooFcn.firebaseToOdoo_ActiveOrInstall(odoo_session, false, Number(context.params.idUserFb));
        functions.logger.info("[firebaseToOdoo_UserTags_update]: The client will be set to <usuario por instalar> tag.", {
          "odoo_session": odoo_session,
          "user_id": context.params.idUserFb,
          "Client_Type_old": Client_Type_old,
          "client_type_old": client_type_old,
          "Client_Type_new": Client_Type_new,
          "client_type_new": client_type_new,
        });
        await OdooFcn.odoo_Logout(odoo_session);
        return null;
      }

      if (listOfActives.includes(client_type_new) && listOfActives.includes(Client_Type_new)) {
        const odoo_session = await OdooFcn.odoo_Login();
        await OdooFcn.firebaseToOdoo_ActiveOrInstall(odoo_session, true, Number(context.params.idUserFb));
        functions.logger.info("[firebaseToOdoo_UserTags_update]: The client will be set to <activo> tag.", {
          "odoo_session": odoo_session,
          "user_id": context.params.idUserFb,
          "Client_Type_old": Client_Type_old,
          "client_type_old": client_type_old,
          "Client_Type_new": Client_Type_new,
          "client_type_new": client_type_new,
        });
        await OdooFcn.odoo_Logout(odoo_session);
        return null;
      }
    }
  }

  if (client_type_new != Client_Type_new) {
    functions.logger.info("[firebaseToOdoo_UserTags_update]: Client "+ user_id+" has different type between Data_client_2 and Data_client_3.", {
      "user_id": user_id,
      "Client_Type_old": Client_Type_old,
      "client_type_old": client_type_old,
      "Client_Type_new": Client_Type_new,
      "client_type_new": client_type_new,
    });
  }

  return null;
});


export let Odoo_Contact_createUser = functions.https.onRequest( (request, response)=> {
  console.log(request.body);
  let request_str = JSON.stringify(request.body);
  console.log(request_str);
  let res = 30900; // 0 > error
  response.send(res);
}
);

export let Odoo_CRM_createUser = functions.https.onRequest( (request, response)=> {
  console.log(request.body);
  let request_str = JSON.stringify(request.body);
  console.log(request_str);
  let res = 30900; // 0 > error
  response.send(res);
});
