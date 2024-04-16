import * as functions from "firebase-functions";
import * as OdooFcn from "./Odoo_utils";
import * as FirebaseFcn from "./Firebase_utils";
import * as settings from "./GlobalSetting";
import * as admin from "firebase-admin";

// const timeoutSeconds_ = 540;
// const schedule_= "every 10 minutes";
const timeoutSeconds_ = 54;
const schedule_= "every 1 minutes";


// FROM FIREBASE TO ODOO
export let firebaseToOdoo_Stops_update : any; // [IN PRODUCTION] if stops change in firebase, updates partner's tag in odoo
export let firebaseToOdoo_Routes_update : any;// [IN PRODUCTION] if Route change in firebase, updates partner's tag in odoo
export let firebaseToOdoo_Stops_create : any;// [IN PRODUCTION] if stop is created in firebase, creates the tag in odoo
export let firebaseToOdoo_Routes_create : any;// [IN PRODUCTION] if Route is created in firebase, creates the tag in odoo
export let firebaseToOdoo_UserTags_update: any;
export let firebaseToOdoo_Tickets_update: any;
export let firebaseToOdoo_Act_approve: any;
export let firebaseToOdoo_CRM_update: any;

// FROM ODOO TO FIREBASE
export let odooToFirebase_syncUsers : any;// if users or ticket changed in odoo, it changes it in firebase'
export let odooToFirebase_syncServices: any;
export let check_payments : any;
export let send_errors_mailreminder: any;

// TRIGGERS INSIDE FIREBASE
export let firebase_Stops_UsersQuantity_update : any;// [IN PRODUCTION] it stops changed, it updates users_quantity if necesary

// Odoo
export let Odoo_update_user: any;//  update... user in Odoo and Dataclient in firebase
export let Odoo_Contact_createUser: any;//  create user in Odoo and Dataclient in firebase
export let Odoo_CRM_createUser: any; //  create user in Odoo and notRegisteredUsers in firebase
export let Odoo_CreateUser: any; // create user in Odoo and CRM opportunitie

export let ReadInventory_Odoo: any; // create user in Odoo and CRM opportunitie
export let ReadZones: any; // create user in Odoo and CRM opportunitie
export let ReadMedia: any; // create user in Odoo and CRM opportunitie
export let ReadSources: any; // create user in Odoo and CRM opportunitie
export let ReadAgents: any; // create user in Odoo and CRM opportunitie
export let ReadZonesMediaSources: any; // create user in Odoo and CRM opportunitie

export let CheckCRMLocal: any; // just local
export let askcrmid: any; // just local
export let RewriteTestUsers: any; // just local


// Firebase Connection Settings
const serviceAccount = require( settings.get_serviceAccount() );
export const urldatabase = settings.get_urldatabase();

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


// Here
firebaseToOdoo_UserTags_update = functions.database.ref("/Data_client/{idUserFb}").onUpdate(async (change, context) => {
  const user_id = Number(context.params.idUserFb);
  // const listOfActives = ["Cliente Nuevo", "Cliente suspendido", "Cliente por llamar", "Cliente piloto", "Cliente normal", "Cliente gold"];

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
        await OdooFcn.firebaseToOdoo_ActiveOrInstall(odoo_session, Number(context.params.idUserFb));
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

      /* //Cambio a activo
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
      } // */

      // Consultar
      if ((client_type_new === "Cliente con Venta perdida") && (Client_Type_new === "Cliente con Venta perdida")) {
        const ticket_id = await FirebaseFcn.firebaseGet("/CRM_tickets_not_archived/"+ context.params.idUserFb);
        const odoo_session = await OdooFcn.odoo_Login();
        await OdooFcn.firebaseToOdoo_updateCRM(odoo_session, 0, ticket_id, false);
        functions.logger.info("[firebaseToOdoo_UserTags_update]: The ticket will be set to Cliente con Venta perdida.", {
          "odoo_session": odoo_session,
          "user_id": context.params.idUserFb,
          "ticket_id": ticket_id,
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


firebaseToOdoo_Tickets_update = functions.database.ref("/Service_collection/{idTicketFb}").onUpdate(async (change, context) => {
  const ticket_before = change.before.val();
  const ticket_after = change.after.val();

  const status_before = ticket_before["ticket_status"];
  const status_after = ticket_after["ticket_status"];

  if (status_after === status_before) return null;
  else {
    if (status_before === "Nuevo") {
      if (status_after === "En progreso") {
        const description_before = ticket_before["ticket_commits"];
        const description_after = ticket_after["ticket_commits"];

        const initialState = {
          "ticket_status": status_before,
          "ticket_commits": description_before,
        };

        const targetlState = {
          "ticket_status": status_after,
          "ticket_commits": description_after,
        };

        const odoo_session = await OdooFcn.odoo_Login();
        await OdooFcn.firebaseToOdoo_updateTickets(odoo_session, Number(context.params.idTicketFb), description_after);
        functions.logger.info("[firebaseToOdoo_Tickets_update]: Ticket updated in Odoo.", {
          "odoo_session": odoo_session,
          "ticket_id": context.params.idTicketFb,
          "initialState": initialState,
          "targetState": targetlState,
        });
        await OdooFcn.odoo_Logout(odoo_session);
        return true;
      }
    }
  }
  return null;
});

firebaseToOdoo_Act_approve = functions.database.ref("/ServiceData_AprovPendant/{idTicketFb}").onDelete(async (change, context) => {
  const ServiceData = await FirebaseFcn.firebaseGet("/ServiceData/" + context.params.idTicketFb);
  const service_definition = ServiceData["Service_definition"];
  const Inventory = ServiceData["Inventory"];

  const listOfInv: Map<string, number> = new Map([]);

  const list = Object.keys(Inventory);

  for (let i = 0; i < list.length; i++) {
    const id_group = list[i];

    const group = Inventory[id_group];
    const items = Object.keys(group);

    for (let j = 0; j < items.length; j++) { //
      const id_item = items[j];
      try {
        const item = group[id_item];
        if (id_item != "group_name" && id_item != undefined) {
          const art_name = item["art_name"];
          const art_qtty = item["art_qtty"];

          const cond1 = (art_name != "Otros:");
          const cond2 = ((art_qtty!=null) && ((art_qtty != "")));

          if (cond1 && cond2) {
            if (Number(art_qtty) > 0.001) {
              listOfInv.set(art_name, Number(art_qtty));
            }
          }
        }
      } catch (err) {
        functions.logger.error("[firebaseToOdoo_Act_approve] Error while reading inventory. ERROR: " + err, {
          "ticket_id": context.params.idTicketFb,
          "item_id": String(id_item),
        });
      }
    }
  }

  if (service_definition["ticket_status"] === "Terminado") {
    const odoo_session = await OdooFcn.odoo_Login();

    await OdooFcn.firebaseToOdoo_approveTicket(odoo_session, Number(context.params.idTicketFb), true);
    functions.logger.info("[firebaseToOdoo_Act_approve]: Ticket finalized in Odoo.", {
      "odoo_session": odoo_session,
      "ticket_id": context.params.idTicketFb,
      "stage_id": 14,
    });

    if (service_definition["ticket_type"] != "Desinstalación") {
      functions.logger.info("[firebaseToOdoo_Act_approve]: Creating inventory in Odoo.", {
        "odoo_session": odoo_session,
        "ticket_id": context.params.idTicketFb,
        "listOfInv": listOfInv,
      });
      await OdooFcn.firebaseToOdoo_stock(odoo_session, Number(service_definition["id_client"]), listOfInv, context.params.idTicketFb);
    }

    await OdooFcn.odoo_Logout(odoo_session);
    return true;
  }

  if (service_definition["ticket_status"] === "Nuevo") {
    const odoo_session = await OdooFcn.odoo_Login();
    await OdooFcn.firebaseToOdoo_approveTicket(odoo_session, Number(context.params.idTicketFb), false);
    functions.logger.info("[firebaseToOdoo_Act_approve]: Ticket restarted in Odoo.", {
      "odoo_session": odoo_session,
      "ticket_id": context.params.idTicketFb,
      "stage_id": 1,
    });
    await OdooFcn.odoo_Logout(odoo_session);
    return true;
  } // */
  return null;
});

Odoo_Contact_createUser = functions.https.onRequest( async (request, response)=> {
  try {
    const odoo_session = await OdooFcn.odoo_Login();

    if (odoo_session != null) {
      const res = await OdooFcn.createUser_Odoo_firebase(odoo_session, request.body.contact_json, request.body.id_ticket_crm);
      await OdooFcn.odoo_Logout(odoo_session);
      response.send(res);
    }
  } catch (error) {
    functions.logger.error( "[Odoo_Contact_createUser] ERROR ", error);
    response.send("Error");
  }
});

firebaseToOdoo_CRM_update = functions.database.ref("/notRegisteredUsers/{idTicketFb}").onUpdate(async (change, context) => {
  const ticket_id = Number(context.params.idTicketFb);

  const ticket_before = change.before.val();
  const ticket_after = change.after.val();

  const Client_Type_old = ticket_before["Client_Type"];
  const Client_Type_new = ticket_after["Client_Type"];

  if (Client_Type_new != Client_Type_old) {
    if (Client_Type_new === "Client_Type_new") {
      const odoo_session = await OdooFcn.odoo_Login();

      await OdooFcn.firebaseToOdoo_updateCRM(odoo_session, 0, ticket_id, false);
      functions.logger.info("[firebaseToOdoo_CRM_update]: The CRM ticket "+ ticket_id+" will be set to Cliente con Venta perdida.", {
        "odoo_session": odoo_session,
        "ticket_id": ticket_id,
        "Client_Type_old": Client_Type_old,
        "Client_Type_new": Client_Type_new,
      });
      await OdooFcn.odoo_Logout(odoo_session);
    }
  }
});

// odooToFirebase_syncUsers = functions.https.onRequest(async (request, response)=> {
odooToFirebase_syncUsers = functions
    .runWith({timeoutSeconds: timeoutSeconds_})
    .pubsub.schedule(schedule_)
    .timeZone("America/Lima")
    .onRun(async () =>{
      // this will run with certain periodicity. This will be the stable function.
      // Here will be everything at the moment. eventually we will separate them to test each one of these.

      try {
        // const lastupdateTimestamp_campaigns = await FirebaseFcn.firebaseGet("/timestamp_collection/CMR_campaings_timestamp");
        // const lastupdateTimestamp_tickets = await FirebaseFcn.firebaseGet("/timestamp_collection/tickets_timestamp");
        const lastupdateTimestamp_crm = await FirebaseFcn.firebaseGet("/timestamp_collection/CMR_tickets_timestamp");
        const lastupdateTimestamp_users = await FirebaseFcn.firebaseGet("/timestamp_collection/ussersTimeStamp");

        const odoo_session = await OdooFcn.odoo_Login();

        if (odoo_session != null) {
          // await OdooFcn.odooToFirebase_all(odoo_session, lastupdateTimestamp_users, lastupdateTimestamp_tickets, lastupdateTimestamp_crm, lastupdateTimestamp_campaigns);
          // let campaings_success = await OdooFcn.odooToFirebase_Campaigns(odoo_session, lastupdateTimestamp_campaigns);
          // let serviceTickets_success = await OdooFcn.odooToFirebase_ServiceTickets(odoo_session, lastupdateTimestamp_tickets);
          let crm_tickets_success = await OdooFcn.odooToFirebase_CRMTickets(odoo_session, lastupdateTimestamp_crm);
          let users_success = await OdooFcn.odooToFirebase_Users(odoo_session, lastupdateTimestamp_users);
          await OdooFcn.odoo_Logout(odoo_session);

          if ( !crm_tickets_success || ! users_success ) {
            functions.logger.error("[odooToFirebase_syncUsers] Error 2510231538 Something Bad Happen", {
              "odoo_session": odoo_session,
              // "campaings_success": campaings_success,
              // "serviceTickets_success": serviceTickets_success,
              "crm_tickets_success": crm_tickets_success,
              "users_success": users_success,
            });
          }
        }
        // response.send("odooToFirebase_syncUsers. odoo_session: .." + odoo_session?.substring(odoo_session.length - 5));
        return true;
      } catch (error) {
        functions.logger.error( "[odooToFirebase_syncUsers] ERROR at Start. ", error);
        // response.send("odooToFirebase_syncUsers Error: "+error);
        return false;
      }
    });

// odooToFirebase_syncServices = functions.https.onRequest(async (request, response)=> {
odooToFirebase_syncServices = functions
    .runWith({timeoutSeconds: timeoutSeconds_})
    .pubsub.schedule(schedule_)
    .timeZone("America/Lima")
    .onRun(async () =>{
      // this will run with certain periodicity. This will be the stable function.
      // Here will be everything at the moment. eventually we will separate them to test each one of these.

      try {
        const lastupdateTimestamp_campaigns = await FirebaseFcn.firebaseGet("/timestamp_collection/CMR_campaings_timestamp");
        const lastupdateTimestamp_tickets = await FirebaseFcn.firebaseGet("/timestamp_collection/tickets_timestamp");

        const odoo_session = await OdooFcn.odoo_Login();

        if (odoo_session != null) {
          // await OdooFcn.odooToFirebase_all(odoo_session, lastupdateTimestamp_users, lastupdateTimestamp_tickets, lastupdateTimestamp_crm, lastupdateTimestamp_campaigns);
          let campaings_success = await OdooFcn.odooToFirebase_Campaigns(odoo_session, lastupdateTimestamp_campaigns);
          let serviceTickets_success = await OdooFcn.odooToFirebase_ServiceTickets(odoo_session, lastupdateTimestamp_tickets);
          await OdooFcn.odoo_Logout(odoo_session);

          if (!campaings_success || !serviceTickets_success ) {
            functions.logger.error("[odooToFirebase_Services] Error 0311231546 Something Bad Happen", {
              "odoo_session": odoo_session,
              "campaings_success": campaings_success,
              "serviceTickets_success": serviceTickets_success,
            });
          }
        }
        // response.send("[odooToFirebase_Services] odoo_session: .." + odoo_session?.substring(odoo_session.length - 5));
        return true;
      } catch (error) {
        functions.logger.error( "[odooToFirebase_Services] ERROR at Start. ", error);
        // response.send("OdooSync Error: "+error);
        return false;
      }
    });


// check_payments = functions.https.onRequest(async (request, response)=> {
check_payments = functions
    .runWith({timeoutSeconds: timeoutSeconds_})
    .pubsub.schedule(schedule_)
    .timeZone("America/Lima")
    .onRun(async () =>{
      const odoo_session = await OdooFcn.odoo_Login();
      let user_with_payment = [];

      let invoice_reference_stack = await FirebaseFcn.firebaseGet("invoice_reference_stack");
      functions.logger.info("[check_payments] Invoice reference stack ", invoice_reference_stack);
      if (invoice_reference_stack) {
        let invoice_reference_stack_keys = Object.keys(invoice_reference_stack).sort();
        // let min = Number(invoice_reference_stack_keys[0])
        let invoice_reference_stack_keys_numbers = invoice_reference_stack_keys.map((str) => {
          return Number(str);
        });

        // console.log("invoice_reference_stack_keys", invoice_reference_stack_keys_numbers);

        user_with_payment = await OdooFcn.read_accountmove_reference(odoo_session, invoice_reference_stack_keys_numbers);


        functions.logger.info("[check_payments] user_with_payment ", user_with_payment);


        for (let i = 0; i< user_with_payment.length; i++) {
          let partner_id_to_remove = user_with_payment[i];
          console.log("partner_id_to_remove", partner_id_to_remove);
          if (partner_id_to_remove) {
            // console.log("invoice_reference_stack/" + partner_id);
            FirebaseFcn.firebaseRemove("invoice_reference_stack/" + partner_id_to_remove);
            // crear ticket de atencion y guardar id en una lista de firebase.
            let user_data = await OdooFcn.get_user_data(odoo_session, Number(partner_id_to_remove), 0);
            let helpdesk_id =await OdooFcn.create_helpdesk_ticket(odoo_session, Number(partner_id_to_remove), user_data.name);
            // console.log("helpdesk_id", helpdesk_id, "helpdesk_stack/" + helpdesk_id);


            // await FirebaseFcn.firebaseSet("helpdesk_stack/" + helpdesk_id, partner_id);
            // cambia etiqueta de usuario a por instalar

            OdooFcn.modify_state_user(odoo_session, user_data, 453, "add");

            const dateTimeEmail = false;
            const subject_str = "Sanimapp: Nuevo Ticket de instalación #" + helpdesk_id + " ("+ user_data.name;
            const welcome_str = "Este es un mensaje del backend. ";
            const message_str = "Se registró el siguiente pago y se creo un ticket de instalacion.";
            let message_container = ["[helpdesk_id: <a target= '_blank' href='" +settings.odoo_url + "#id=" + helpdesk_id + "&model=helpdesk.ticket'>" + helpdesk_id + "</a>] [partner_id: " + partner_id_to_remove + "] [Name: " + user_data.name + "]"];
            FirebaseFcn.sendEmail(subject_str, welcome_str, dateTimeEmail, message_str, message_container);
          }
        }
        return true;
      }
      return false;
      // response.send("check_payments. odoo_session: .." + odoo_session?.substring(odoo_session.length - 5));
    });


const runtimeOpts = {
  timeoutSeconds: 540,
};

exports.test = functions.runWith(runtimeOpts).https.onRequest( async (request, response)=> {
  const odoo_session = await OdooFcn.odoo_Login();
  const firebaseType = await FirebaseFcn.firebaseGet("/firebaseType");


  // OdooFcn.odooToFirebase_Campaigns(odoo_session, lastupdateTimestamp_campaigns);
  /*
  const lastupdateTimestamp_users = await FirebaseFcn.firebaseGet("/timestamp_collection/ussersTimeStamp");
  let success = await OdooFcn.odooToFirebase_Users(odoo_session, lastupdateTimestamp_users);
  console.log("success: ", success);
  console.log(odoo_session);
  console.log(settings.odoo_url);
  */


  // const lastupdateTimestamp_users = await FirebaseFcn.firebaseGet("/timestamp_collection/ussersTimeStamp");

  // await OdooFcn.odooToFirebase_Users_test(odoo_session, lastupdateTimestamp_users);

  // const lastupdateTimestamp_crm = await FirebaseFcn.firebaseGet("/timestamp_collection/CMR_tickets_timestamp");


  // await OdooFcn.odooToFirebase_CRMTickets(odoo_session, lastupdateTimestamp_crm);


  await OdooFcn.odoo_Logout(odoo_session);
  response.send("<p>[TEST] <br>firebaseType: "+firebaseType+"<br>odoo url: <a href='"+settings.odoo_url +"'>"+settings.odoo_url+"</a></p><p>odoo session: "+odoo_session +"</p><p>Everything's working fine</p>");
});
/*

send_errors_mailreminder = functions
    .pubsub.schedule("everyday 08:00")
    .timeZone("America/Lima")
    .onRun(async () =>{
      try {
        const pendand_errors = await FirebaseFcn.firebaseGet("/illegal_entries_stack");
        if (pendand_errors == null ) functions.logger.info( "[send_errors_mailreminder] No pendant error.");
        else {
          const pendand_errors_keys = Object.keys(pendand_errors);


          let message_container = [];
          for (let i = 0; i < pendand_errors_keys.length; i++) {
            message_container.push(pendand_errors[pendand_errors_keys[i]] + "(User_id: " + pendand_errors_keys[i] + ")" );
          }
          const dateTimeEmail = false;
          const subject_str = "Sanimapp Daily Backend Alert";
          const welcome_str = "Esta es una alerta diaria";
          const message_str = "Se registraron los siguientes ingresos que fueron ignorados. Por favor, revisarlos a la brevedad";
          await FirebaseFcn.sendEmail(subject_str, welcome_str, dateTimeEmail, message_str, message_container);
        }
        return true;
        // response.send("<p>[send_errors_mailreminder] <p>Everything's working fine</p>");
      } catch (error) {
        functions.logger.error( "[send_errors_mailreminder] ERROR  ( ", error, ")");
        // response.send("<p>[send_errors_mailreminder] <p>Everything's working fine</p>");
        return false;
      }
    });
    */


/*

exports.test3 = functions
    .https.onRequest( async (request, response)=> {
      try {
        const odoo_session = await OdooFcn.odoo_Login();

        let crm_ticket = {
          "id": 3285,
          "partner_id": false,
          "campaign_id": [
            34,
            "Campaña Febrero",
          ],
          "stage_id": [
            4,
            "Ganado",
          ],
          "medium_id": [
            18,
            "Recomendación",
          ],
          "source_id": [
            24,
            "Recomendación",
          ],
          "referred": false,
          "name": "Lucero Hurtado prueba 3",
          "phone": "+51 908 764 532",
          "mobile": false,
          "tag_ids": [
            2,
          ],
          "create_uid": [
            24,
            "[73015741] HURTADO ROCA LUCERO",
          ],
          "create_date": "2023-09-07 13:51:45",
          "street": "Me b lt10",
          "street2": false,
          "zip": "12/23/2789",
          "order_ids": [],
          "city": "Lima",
          "state_id": [
            1160,
            "Lima (PE)",
          ],
          "country_id": [
            173,
            "Perú",
          ],
        };

        let crm_id = crm_ticket["id"];
        let res_id = 31559;

        let crm_name = crm_ticket.name;


        let sale_order_status= await OdooFcn.create_sale_order_and_invoice(odoo_session, crm_id, crm_name, res_id);
        if (sale_order_status == false) {
          console.log("error 404. create_sale_order_and_invoice not working well");
          response.send("<p>[2] <p>Something wrong</p>");
        } else {
          console.log("create_sale_order_and_invoice ok");
          response.send("<p>[3] <p>Everything's working fine</p>");
        }
      } catch (error) {
        functions.logger.error("[test3] ERROR 2410231411: " + error);
      }
    });

exports.test4 = functions
    .https.onRequest( async (request, response)=> {
      // download invoice stack

      let min = 9999999;

      try {
        let invoice_reference_stack = await FirebaseFcn.firebaseGet("invoice_reference_stack");
        console.log(invoice_reference_stack);
        let invoice_reference_stack_keys = Object.keys(invoice_reference_stack);


        console.log(invoice_reference_stack_keys);


        min = Number( invoice_reference_stack_keys.sort()[0] ); // to search invoices
      } catch (error) {
        response.send("<p>[test4] <p>Something wrong</p>");
      }

      try {
        const odoo_session = await OdooFcn.odoo_Login();
        let references = await OdooFcn.read_accountmove_reference(odoo_session, min);
        console.log(references);
      } catch (error) {
        functions.logger.error("[test4] ERROR 2410231413: " + error );
      }

      response.send("<p>[test4] <p>Everything working fine</p>");
    });


exports.test5 = functions
    .https.onRequest( async (request, response)=> {
      try {
        const odoo_session = await OdooFcn.odoo_Login();

        await OdooFcn.getItemsCollection(odoo_session);


        await OdooFcn.odoo_Logout(odoo_session);
      } catch (error) {
        functions.logger.error("[test5] ERROR 2601241414: " + error );
      }

      response.send("<p>[test5] <p>Everything working fine</p>");
    });
*/

exports.test_create = functions.runWith(runtimeOpts).https.onRequest( async (request, response)=> {
  const odoo_session = await OdooFcn.odoo_Login();
  const firebaseType = await FirebaseFcn.firebaseGet("/firebaseType");

  try {
    let crm_id = await OdooFcn.createTicketCRM(odoo_session, {
      "priority": "3",
      "name": "c",
    });
    const dateTime = Date.now();
    let _data = {
      "name": "Vluedot test " + dateTime,
      "stage_id": 1,
    };
    console.log(crm_id);
    let user_id = await OdooFcn.create_user_in_Odoo2(odoo_session, crm_id, _data);

    OdooFcn.update_crm_data(odoo_session, crm_id, _data);

    await OdooFcn.odoo_Logout(odoo_session);
    response.send("<p>[TEST_create] <br>firebaseType: "+firebaseType+"<br>odoo url: "+settings.odoo_url +
  "</p><p>odoo session: "+odoo_session+
  "</p><p>Everything's working fine</p>" +
  "crm_id: " + crm_id + "<br> <a target= '_blank' href='" +settings.odoo_url + "#id=" + crm_id+"&model=crm.lead'> link </a> <br>" +
  "user_id: " + user_id + "<br> <a target= '_blank' href='" +settings.odoo_url + "#id=" + user_id+"&model=res.partner'> link </a> <br>");
  } catch (error) {
    response.send("ERROR: " + error);
  }
});

/*

Odoo_CRM_createUser = functions.https.onRequest( async (request, response)=> {
  const odoo_session = await OdooFcn.odoo_Login();

  // functions.logger.info("[Odoo_CRM_createUser]: Test odoo 2", request.body);
  let date = Date.now();
  const entry_exist= await OdooFcn.readTicketCRM(odoo_session, date, request.body.args);
  let idOdoo;
  if (entry_exist == false ) {
    idOdoo = await OdooFcn.createTicketCRM(odoo_session, request.body.args);


    await OdooFcn.odoo_Logout(odoo_session);
    if (idOdoo != null) {
      let referred = "";
      referred = request.body.args["referred"];
      if (referred === undefined) referred = "NaN";

      let phone = "";
      phone = request.body.args["phone"];
      if (phone === undefined) phone = "NaN";

      let mobile = "";
      mobile = request.body.args["mobile"];
      if (mobile === undefined) mobile = "NaN";

      let comunity = request.body.args["function"];
      if (comunity === "") comunity = "NaN";

      date = Date.now();

      const targetState = {
        "Campaign_month": request.body.data.Campaign_month,
        "How_know_us": request.body.data.How_know_us,
        "How_know_us_method": request.body.data.How_know_us_method,
        "How_know_us_referals": referred,
        "Name_potencial": request.body.args.name,
        "Phone1": phone,
        "Phone2": mobile,
        "Sales_person": request.body.data.Sales_person,
        "Zone": request.body.data.Zone,
        "timeStampCreate": String(date),
        "Sales_person_Commit": request.body.data.Sales_person_Commit,
        "Lat": 0,
        "Long": 0,
        "Client_Type": "Cliente Potencial",
        "Client_Community": comunity,
      };

      // functions.logger.info("[Odoo_CRM_createUser]: Test firebase", {
      //   "targetState": targetState,
      // });

      await FirebaseFcn.firebaseSet("/notRegisteredUsers/" + idOdoo, targetState);
      functions.logger.info( "[Odoo_CRM_createUser] Ticket created in Firebase (/notRegisteredUsers/"+ idOdoo +").", {
        "targetState": targetState,
        "odoo_session": odoo_session,
      });
      const res = {
        "result": idOdoo,
      };
      response.send(res);
    } else {
      response.send("Error");
    }
  } else {
    await OdooFcn.odoo_Logout(odoo_session);
    functions.logger.info( "[Odoo_CRM_createUser] Skipping. User already exists", {
      "odoo_session": odoo_session,
      "request": request.body,
    });
    response.send("Skipping. Already exists");
  }
});

*/

Odoo_CreateUser = functions.https.onRequest( async (request, response)=> {
  const odoo_session = await OdooFcn.odoo_Login();
  let date = Date.now();
  const entry_exist= await OdooFcn.readTicketCRM(odoo_session, date, request.body.args);
  let crm_id;
  let user_id;


  request.body.args.priority= "3"; // add 3 stars in odoo

  console.log(request.body);


  try {
    if (entry_exist == false ) {
      crm_id = await OdooFcn.createTicketCRM(odoo_session, request.body.args);
      user_id = await OdooFcn.create_user_in_Odoo2(odoo_session, crm_id, request.body.args);


      OdooFcn.odoo_Logout(odoo_session);

      let referred = "";
      referred = request.body.args["referred"];
      if (referred === undefined) referred = "NaN";

      let phone = "";
      phone = request.body.args["phone"];
      if (phone === undefined) phone = "NaN";

      let mobile = "";
      mobile = request.body.args["mobile"];
      if (mobile === undefined) mobile = "NaN";

      let comunity = request.body.args["function"];
      if (comunity === "") comunity = "NaN";

      const targetState = {
        "Campaign_month": request.body.data.Campaign_month,
        "How_know_us": request.body.data.How_know_us,
        "How_know_us_method": request.body.data.How_know_us_method,
        "How_know_us_referals": referred,
        "Name_potencial": request.body.args.name,
        "Phone1": phone,
        "Phone2": mobile,
        "Sales_person": request.body.data.Sales_person,
        "Zone": request.body.data.Zone,
        "timeStampCreate": String(date),
        "Sales_person_Commit": request.body.data.Sales_person_Commit,
        "Lat": request.body.data.latitude,
        "Long": request.body.data.longitude,
        "Client_Type": "Cliente Potencial",
        "Client_Community": comunity,
      };

      if (crm_id != null && user_id != null) {
        const res = {
          "crm_id": crm_id,
          "user_id": user_id,
        };

        console.log( res );


        FirebaseFcn.firebaseSet("/notRegisteredUsers/" + crm_id, targetState);
        functions.logger.info( "[Odoo_CreateUser] Ticket created in Firebase (/notRegisteredUsers/"+ crm_id +").", {
          "targetState": targetState,
          "odoo_session": odoo_session,
        });

        response.send(res);
      } else {
        response.send({"result": 0});
      }
    } else {
      console.log("entry_exist", entry_exist);
      OdooFcn.odoo_Logout(odoo_session);
      functions.logger.error( "[Odoo_CreateUser] Skipping. User already exists.", {
        "odoo_session": odoo_session,
        "request": request.body,
      });
      response.send(entry_exist);
      response.send({"result": 1});
    }
  } catch (error) {
    functions.logger.error( "[Odoo_CreateUser] Skipping. User already exists.", {
      "odoo_session": odoo_session,
      "request": request.body,
      "crm_id": crm_id,
      "user_id": user_id,
    });
    response.send({"result": 2});
  }
});

Odoo_update_user = functions.https.onRequest( async (request, response)=> {
  let crm_data = {
    "phone": request.body.data.phone,
    "mobile": request.body.data.mobile,
    "name": request.body.data.name,
    "street": request.body.data.street,
    // "street_number": " ",
    "street2": request.body.data.street2,
    "zip": request.body.data.zip,
    "country_id": request.body.data.country_id,
    "state_id": request.body.data.state_id,
    "stage_id": request.body.data.stage_id,
    "city": request.body.data.city,


  };

  let res_partner_data = {
    "phone": request.body.data.phone,
    "mobile": request.body.data.mobile,
    "name": request.body.data.name,
    "street_name": request.body.data.street,
    "street_number": " ",
    "street2": request.body.data.street2,
    "zip": request.body.data.zip,
    "country_id": request.body.data.country_id,
    "state_id": request.body.data.state_id,
    "city": request.body.data.city,


    "l10n_latam_identification_type_id": request.body.data.l10n_latam_identification_type_id,
    "vat": request.body.data.vat,

  };

  functions.logger.info( "[Odoo_update_user] Updating user with the following info", {
    "request.body": request.body,
    "crm_data": crm_data,
    "res_partner_data": res_partner_data,


  });

  try {
    const odoo_session = await OdooFcn.odoo_Login();

    if (odoo_session != null) {
      // OdooFcn.update_crm_data(odoo_session, crm_id, _data);
      const res2 = await OdooFcn.update_user_data(odoo_session, request.body.user_id, res_partner_data);

      const res = await OdooFcn.update_crm_data(odoo_session, request.body.crm_id, crm_data);
      OdooFcn.odoo_Logout(odoo_session);
      response.send({"result": res && res2});
    }
  } catch (error) {
    functions.logger.error( "[Odoo_Contact_createUser] ERROR ", error);
    response.send({"result": false});
  }
});

ReadInventory_Odoo = functions.https.onRequest( async (request, response)=> {
  // return false if fail
  // return list of inventory

  try {
    const odoo_session = await OdooFcn.odoo_Login();

    if (odoo_session != null) {
      let res = await OdooFcn.readInventory_Odoo(odoo_session);
      OdooFcn.odoo_Logout(odoo_session);

      if (res != false) {
        const res_json = Object.fromEntries(res);

        response.send(res_json);
      } else response.send({"result": false});
    }
  } catch (error) {
    functions.logger.error( "[ReadInventory_Odoo] ERROR ", error);
    response.send({"result": false});
  }
} );


ReadZones = functions.https.onRequest( async (request, response)=> {
  // return false if fail
  // return list of inventory

  try {
    const odoo_session = await OdooFcn.odoo_Login();

    if (odoo_session != null) {
      let res = await OdooFcn.readZones_Odoo(odoo_session);
      OdooFcn.odoo_Logout(odoo_session);

      if (res != false) {
        const res_json = Object.fromEntries(res);

        response.send(res_json);
      } else response.send({"result": false});
    }
  } catch (error) {
    functions.logger.error( "[readZones_Odoo] ERROR ", error);
    response.send({"result": false});
  }
} );

ReadMedia = functions.https.onRequest( async (request, response)=> {
  // return false if fail
  // return list of inventory

  try {
    const odoo_session = await OdooFcn.odoo_Login();

    if (odoo_session != null) {
      let res = await OdooFcn.readMedia_Odoo(odoo_session);
      OdooFcn.odoo_Logout(odoo_session);

      if (res != false) {
        const res_json = Object.fromEntries(res);

        response.send(res_json);
      } else response.send({"result": false});
    }
  } catch (error) {
    functions.logger.error( "[readMedia_Odoo] ERROR ", error);
    response.send({"result": false});
  }
} );

ReadSources = functions.https.onRequest( async (request, response)=> {
  // return false if fail
  // return list of inventory

  try {
    const odoo_session = await OdooFcn.odoo_Login();

    if (odoo_session != null) {
      let res = await OdooFcn.readSources_Odoo(odoo_session);
      OdooFcn.odoo_Logout(odoo_session);

      if (res != false) {
        const res_json = Object.fromEntries(res);

        response.send(res_json);
      } else response.send({"result": false});
    }
  } catch (error) {
    functions.logger.error( "[readSources_Odoo] ERROR ", error);
    response.send({"result": false});
  }
} );

ReadZonesMediaSources = functions.https.onRequest( async (request, response)=> {
  // return false if fail
  // return list of inventory

  try {
    const odoo_session = await OdooFcn.odoo_Login();

    if (odoo_session != null) {
      let res1 = await OdooFcn.readZones_Odoo(odoo_session);
      let res2 = await OdooFcn.readMedia_Odoo(odoo_session);
      let res3 = await OdooFcn.readSources_Odoo(odoo_session);
      OdooFcn.odoo_Logout(odoo_session);

      if (res1 != false && res2 != false && res3 != false) {
        const res1_json = Object.fromEntries(res1);
        const res2_json = Object.fromEntries(res2);
        const res3_json = Object.fromEntries(res3);
        const res_json = {
          "1": res1_json,
          "2": res2_json,
          "3": res3_json,
        };

        response.send(res_json);
      } else response.send({"result": false});
    }
  } catch (error) {
    functions.logger.error( "[ReadZonesMediaSources] ERROR ", error);
    response.send({"result": false});
  }
} );


askcrmid = functions.https.onRequest( async (request, response)=> {
  try {
    const odoo_session = await OdooFcn.odoo_Login();

    if (odoo_session != null) {
      let crm_id = await OdooFcn.askcrmid(odoo_session, request.body.user_id);

      OdooFcn.odoo_Logout(odoo_session);


      response.send({"crm_id": crm_id});
    } else response.send({"result": false});
  } catch (error) {
    functions.logger.error( "[askcrmid] ERROR ", error);
    response.send({"result": false});
  }
} );
/*

CheckCRMLocal = functions.runWith(runtimeOpts).https.onRequest( async (request, response)=> {
  // check users that dont have oportunity
  // download data and form crm_json
  //create crm_json in odoo.

  try {
    const odoo_session = await OdooFcn.odoo_Login();

    if (odoo_session != null) {
      let user_dataset = await OdooFcn.checkUserNoCRM(odoo_session);

      // console.log("user_dataset ", user_dataset);

      for(let user_data in user_dataset) {
        console.log("------- " + user_data);
      //create crm_json
      let user = user_dataset[user_data]

      console.log("user", user);
      // console.log(user.category_id)

      // if(user.category_id.includes(358)){
      //   console.log("category_id 358 ACTIVO")
      // }else console.log("--")

      let crm_json = {
        "name": user.display_name,
        "phone": user.phone,
        "mobile": user.mobile,
        "tag_ids": [2],
        "campaign_id": 1,
        "medium_id": 42,
        "source_id": 1,
        "color": 5,//11 purple
        "stage_id": user.category_id.includes(358)? 4:3 ,
        "referred": 'ACTUALIZADO MASIVAMENTE ',
        "function": user.function,
        "type": 'opportunity',
        "user_id": 15,
        // "priority": '3',
        "partner_id": user.id

      }

      console.log("crm_json: " )
      console.log(crm_json)
      let crm_id = await OdooFcn.createTicketCRM(odoo_session, crm_json);
      console.log("crm_id ", crm_id)


    }

      OdooFcn.odoo_Logout(odoo_session);


        response.send(
           {
            "user_id":1

          });
      } else response.send({"result": false});
    }
   catch (error) {
    functions.logger.error( "[CheckCRMLocal] ERROR ", error);
    response.send({"result": false});
  }
} )

RewriteTestUsers = functions.https.onRequest( async (request, response)=> {
  // check users from ODOO
  // download data and form crm_json
  //create crm_json in odoo.

  try {
    const odoo_session = await OdooFcn.odoo_Login();

    if (odoo_session != null) {

      let differ = await OdooFcn.RewriteTestUsers(odoo_session);


      OdooFcn.odoo_Logout(odoo_session);


        response.send(
           {
            "differ": differ

          });
    }
    else response.send({"result": false});
    }
   catch (error) {
    functions.logger.error( "[CheckCRMLocal] ERROR ", error);
    response.send({"result": false});
  }
} )


*/


exports.test_encription = functions.runWith(runtimeOpts).https.onRequest( async (request, response)=> {

  try {
    const dateTimeEmail = false;
            const subject_str = "Sanimapp Encriptation Test";
            const welcome_str = "Este es un mensaje del backend. ";
            const message_str = "Se registró el siguienteTest.";
            let message_container = ["No container"];
            FirebaseFcn.sendEmail2(subject_str, welcome_str, dateTimeEmail, message_str, message_container);

    response.send({"result": true});


  } catch (error) {
  response.send({"result": error});

  }


});
