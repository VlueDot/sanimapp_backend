import fetch from "node-fetch";
import * as settings from "./GlobalSetting";
import * as functions from "firebase-functions";
import * as FirebaseFcn from "./Firebase_utils";


// const max_qtty_entries_per_session = 2500; // per 10 minutes
const max_qtty_entries_per_session = 300;

let info = {
  "odoo_session": 0,
  "user_id": 0,
  "stop_id_odoo": 0,
  "stop_id_firebase": 0,
  "stop_name": "",
  "route_id_odoo": 0,
  "route_id_firebase": 0,
  "route_name": "",

};


export async function odoo_Login() {
  const response = await fetch(settings.odoo_url + "session/authenticate", settings.odoo_access);
  const data = await response.json();
  const data_headers = await response.headers.get("set-cookie");
  const odoo_session = data_headers?.split("=", 2)[1].split(";", 1)[0];

  if (response.status === 200) {
    try {
      // functions.logger.info("[odoo_Login] Odoo Authentication Succeeded.", {"odoo_session": odoo_session, "db": settings.odoo_db});
      return odoo_session;
    } catch (error) {
      functions.logger.error("[odoo_Login] Odoo Authentication Failed: " + data["error"]["message"] );
    }
  } else functions.logger.error("[odoo_Login] OdooLogin Error: unexpected " + response.status );

  return null;
}

export async function odoo_Logout(odoo_session:any) {
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  // from OdooGenerateJsonsToWriteOdoo function
  const raw = JSON.stringify({});

  const params = {
    headers: CustomHeaders,
    method: "post",
    body: raw,
  };

  const response = await fetch(settings.odoo_url + "session/logout", params);
  // if (response.status === 200) {
  //   functions.logger.info( "[odoo_Logout] Odoo Logout Succeeded. ", {"odoo_session": odoo_session});
  // } else functions.logger.error("[odoo_Logout] OdooLogout Error: unexpected " + response.status, {"odoo_session": odoo_session});

  if (response.status != 200) {
    functions.logger.error("[odoo_Logout] OdooLogout Error: unexpected " + response.status, {"odoo_session": odoo_session});
  }

  return response.status;
}

export async function odooToFirebase_Users(odoo_session:any, lastupdateTimestamp:any) {
  let illegal_entries_stack;
  // const max_qtty_entries_per_session = 40;

  let warning_list = [];
  let warning_list_map = new Map();

  if (lastupdateTimestamp==null) lastupdateTimestamp = 0;
  const date = new Date(Number(lastupdateTimestamp));
  const date_str = "'"+ date.getFullYear()+"-"+("0" + (date.getMonth() + 1)).slice(-2)+"-"+("0" +date.getDate()).slice(-2)+" "+ ("0" +date.getHours()).slice(-2)+":"+("0" +date.getMinutes()).slice(-2)+":"+("0" +date.getSeconds()).slice(-2) + "'";
  // console.log(date_str);
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  let categories_list;

  // first obtain all categories
  try {
    categories_list = await getCategories(odoo_session);
    if (categories_list.length == 0) {
      functions.logger.error( "[odooToFirebase_Users] ERROR No categories: ", {"odoo_session": odoo_session} );
      return false;
    }
  } catch (error) {
    functions.logger.error( "[odooToFirebase_Users] ERROR No categories: " + error, {"odoo_session": odoo_session} );
    return false;
  }

  // console.log("cate list ", categories_list)


  try {
    const raw = JSON.stringify({
      "params": {
        "model": "res.partner",
        "offset": 0,
        "fields": [
          "id", "name", "phone", "mobile", "zip",
          "vat", "street", "street2", "city", "country_id", "display_name", "category_id", "write_date", "opportunity_ids"],
        "domain": [["write_date", ">", date_str]],
      },
    });

    const params = {
      headers: CustomHeaders,
      method: "post",
      body: raw,
    };
    const response = await fetch(settings.odoo_url + "dataset/search_read/", params);
    let odoo_query_time = Date.now();
    let data;
    data = await response.json();
    let entries;
    let entries_sorted;

    const qtty_entries = data.result.length;


    if (qtty_entries > 0) {
      functions.logger.info("[odooToFirebase_Users] Se ejecutó el siguiente query.", {"odoo_session": odoo_session, "raw": raw});

      let qtty_users = max_qtty_entries_per_session > qtty_entries ? qtty_entries : max_qtty_entries_per_session;
      entries = data.result.records;
      entries_sorted = entries.sort((e:any, f:any) => Date.parse(e.write_date) - Date.parse(f.write_date));

      entries_sorted = entries_sorted.slice(0, qtty_users);


      // donwload illegal_entries_stack
      let illegal_entries_stack_keys;
      try {
        if (illegal_entries_stack != null) {
          illegal_entries_stack = await FirebaseFcn.firebaseGet("illegal_entries_stack");
          illegal_entries_stack_keys = Object.keys(illegal_entries_stack);

          for (let index=0; index< illegal_entries_stack_keys.length; index ++) warning_list_map.set(illegal_entries_stack_keys[index], illegal_entries_stack[illegal_entries_stack_keys[index]]);

          functions.logger.warn( "warning_list_map", warning_list_map);
        }
      } catch (error) {
        functions.logger.error("[odooToFirebase_Users] ERROR 0211230156 ", error);
      }


      const fb_stops = await FirebaseFcn.firebaseGet("stops");
      const keys = Object.keys(fb_stops);

      const fb_routes = await FirebaseFcn.firebaseGet("Route_definition");
      const keys_routes = Object.keys(fb_routes);

      const target_data = entries_sorted;
      functions.logger.info( "[odooToFirebase_Users] Entries Founded:  ",
          {"odoo_session": odoo_session,
            "target_data": target_data,
          } );


      let count_correct = 0;

      for (let i= 0; i<qtty_users; i++) {
        const user_id = target_data[i].id;
        const user_name = target_data[i].name;
        const user_categories = target_data[i].category_id;
        const opportunity_id_len = target_data[i].opportunity_ids.length;
        let crm_id = opportunity_id_len == 1 ? target_data[i].opportunity_ids[0] : false;
        odoo_query_time = Date.parse(target_data[i].write_date);

        let user_state_from_firebase;
        let user_status_name ="NaN"; // if NaN its error
        try {
          // check for categories
          // alternatively we could download every stops and categories. depending on demand or testings

          console.log("------------", i+1, "/", qtty_users, "[", user_id, " - ", crm_id, "]------------");
          // console.log(user_categories);
          let user_categories_filtered = await search_categories_Odoo( user_categories, categories_list );
          // console.log("user_categories_filtered: ", user_categories_filtered);


          // STOPS ----------------------------------------------------------------
          const user_stop_data = user_categories_filtered.filter( (e:any) => e.name.includes("Paradero:"));
          // ROUTES ----------------------------------------------------------------
          const user_route_data = user_categories_filtered.filter( (e:any) => e.name.includes("Ruta:"));
          // ESTADO ----------------------------------------------------------------
          const user_status_data = user_categories_filtered.filter( (e:any) => e.name.includes("usuario activo") || e.name.includes("usuario inactivo") || e.name.includes("Usuario por instalar"));


          // console.log("user_stop_data: ", user_stop_data);
          // console.log("user_route_data: ", user_route_data);
          console.log("user_status_data: ", user_status_data);
          // [ { id: 358, name: 'usuario activo' } ]
          // FILTERS DEFINE STATES
          let legal_task = true;
          let reason;
          let no_entry_in_firebase = false;
          let user_state_is_NaN = false;

          const usuario_inactivo_tags = ["Cliente desinstalado"];
          const usuario_activo_tags = ["Cliente Nuevo", "Cliente normal"];
          const usuario_instalar_tags = ["Cliente por instalar"];
          const usuario_ganado_tags = ["Cliente ganado"];

          // let tsss = Date.now()
          // let ts_2  =tsss
          // console.log("tsss" , tsss)
          // tsss = tsss + 40*1000
          // console.log(tsss)

          // while(tsss > ts_2) {ts_2 = Date.now()}

          if (user_status_data.length == 1 || opportunity_id_len ==1) {
            user_state_from_firebase = await FirebaseFcn.firebaseGet("Data_client/" + user_id +"/Data_client_2/Client_Type" );
            let user_state2_from_firebase = await FirebaseFcn.firebaseGet("Data_client/" + user_id +"/Data_client_3/client_type" );


            if (user_state2_from_firebase == null && user_state_from_firebase == null) {
              no_entry_in_firebase = true;
              const notRegisteredUsers_data = await FirebaseFcn.firebaseGet("/notRegisteredUsers/" + crm_id );
              user_state_from_firebase = notRegisteredUsers_data["Client_Type"];
              user_state2_from_firebase = notRegisteredUsers_data["Client_Type"];
              console.log("obtaining data from notregistered users: ", {
                "crm_id": crm_id,
                "user_state_from_firebase": user_state_from_firebase});
            }

            if (user_state2_from_firebase == "NaN" && user_state_from_firebase == "NaN") user_state_is_NaN = true;


            if (user_state2_from_firebase != user_state_from_firebase && !no_entry_in_firebase ) {
              legal_task = false;
              reason = "Different user states found in firebase. Fix it first. (" + user_state_from_firebase +", "+ user_state2_from_firebase+")";
              warning_list.push(user_name + " ("+ user_id +") " + reason);
              warning_list_map.set(user_id, "("+ user_name +") " + reason);
            } else {
              let user_state_from_firebase_Odoo_label;
              if (usuario_instalar_tags.includes(user_state_from_firebase)) user_state_from_firebase_Odoo_label = "Usuario por instalar";
              if (usuario_activo_tags.includes(user_state_from_firebase)) user_state_from_firebase_Odoo_label = "usuario activo";
              if (usuario_inactivo_tags.includes(user_state_from_firebase)) user_state_from_firebase_Odoo_label = "usuario inactivo";
              if (usuario_ganado_tags.includes(user_state_from_firebase)) user_state_from_firebase_Odoo_label = "Cliente ganado";

              // try {
              //   console.log("-----1", user_status_data[0].name, user_state_from_firebase_Odoo_label);
              // } catch (error) {
              //   true;
              // }

              // let printdata = {
              //   "user_state_from_firebase": user_state_from_firebase,
              //   "user_state_from_firebase_Odoo_label": user_state_from_firebase_Odoo_label,
              //   "user_status_data[0].name ": user_status_data[0].name,
              //   "user_status_name": user_status_name,
              //   "legal_task": legal_task,
              //   "reason": reason,
              // };

              // console.log(printdata);

              if (user_stop_data[0] == undefined) {
                true;
              } else {
                if ( user_status_data[0].name == "Usuario por instalar" ) {
                  if ( no_entry_in_firebase || user_state_from_firebase_Odoo_label == "Usuario por instalar" || user_state_is_NaN || user_state_from_firebase_Odoo_label =="usuario inactivo" || user_state_from_firebase_Odoo_label == "Cliente ganado") {
                    true;
                  } else {
                    legal_task = false;
                    reason = "Forbidden move 1. From Firebase " + user_state_from_firebase_Odoo_label + " ("+ user_state_from_firebase +") ---> 'Usuario por instalar' ";
                    warning_list.push(user_name + " ("+ user_id +") " + reason);
                    warning_list_map.set(user_id, "("+ user_name +") " + reason);
                  }
                }

                if ( user_status_data[0].name == "usuario activo" ) {
                  if (user_state_from_firebase_Odoo_label == "Usuario por instalar" || user_state_from_firebase_Odoo_label == "usuario activo" ) {
                    if (user_stop_data.length == 0) {
                      legal_task = false;
                      reason = "Forbidden move 2. Impossible to set Usuario activo without stop";
                      warning_list.push(user_name + " ("+ user_id +") " + reason);
                      warning_list_map.set(user_id, "("+ user_name +") " + reason);
                    } else if (user_stop_data.length > 1) {
                      legal_task = false;
                      reason = "Forbidden move 3. Impossible to set Usuario activo with more than 1 stop " + user_stop_data;
                      warning_list.push(user_name + " ("+ user_id +") " + reason);
                      warning_list_map.set(user_id, "("+ user_name +") " + reason);
                    }
                  } else {
                    legal_task = false;
                    reason = "Forbidden move 4. From Firebase " + user_state_from_firebase_Odoo_label + " ("+ user_state_from_firebase +") ---> 'usuario activo' ";
                    warning_list.push(user_name + " ("+ user_id +") " + reason);
                    warning_list_map.set(user_id, "("+ user_name +") " + reason);
                  }
                }

                if ( user_status_data[0].name == "usuario inactivo" ) {
                  if (user_state_from_firebase_Odoo_label == "usuario activo" || user_state_from_firebase_Odoo_label == "usuario inactivo") {
                    true;
                  } else {
                    legal_task = false;
                    reason = "Forbidden move 5. From Firebase " + user_state_from_firebase_Odoo_label + " ("+ user_state_from_firebase +") ---> 'usuario inactivo' ";
                    warning_list.push(user_name + " ("+ user_id +") " + reason);
                    warning_list_map.set(user_id, "("+ user_name +") " + reason);
                  }
                }
              }
              // console.log(printdata);
            }
          } else {
            if (user_status_data.length == 0) {
              // check at least if it has an oportunity
              if (opportunity_id_len == 0) reason = "There is no state for a client and no opportunity in crm. Will be ignored.";
              else if (opportunity_id_len >1) reason = "There is no state for a client and more than 1 opportunitty in crm. Is that ok? Will be ignored.";
            } else reason = "There are more than 1 one state for a client. Will be ignored.";
            warning_list.push( user_name + " ("+ user_id +") " + reason);
            warning_list_map.set(user_id, "("+ user_name +") " + reason);
            legal_task = false;
          }

          try {
            if (legal_task) {
              // STOPS ----------------------------------------------------------------

              let user_stopId = 0; let user_namestop = "NaN";

              if (user_stop_data.length > 0 && (user_status_data[0].name == "usuario activo" || user_status_data[0].name == "Usuario por instalar")) {
                user_stopId = user_stop_data[0].id;
                user_namestop = user_stop_data[0].name;
              }

              // ROUTES ----------------------------------------------------------------
              let user_routeId = 0; let user_nameroute = "NaN";


              if (user_route_data.length > 0 && (user_status_data[0].name == "usuario activo" || user_status_data[0].name == "Usuario por instalar")) {
                user_routeId = user_route_data[0].id;
                user_nameroute = user_route_data[0].name;
              }

              const initialOdoo_routeId = user_routeId;

              // ESTADO ----------------------------------------------------------------


              // console.log("user_status_data" , user_status_data)
              // check if is paid

              let user_with_payment = await read_accountmove_reference(odoo_session, [user_id]);
              let user_paid = user_with_payment.length > 0;


              if (user_status_data.length > 0) {
                if (user_paid) {
                  if ( user_status_data[0].name == "Usuario por instalar") user_status_name = "Cliente por instalar";
                  else if ( user_status_data[0].name == "usuario inactivo") user_status_name = "Cliente desinstalado";
                  else if ( user_status_data[0].name == "usuario activo" && user_stop_data.length == 1) user_status_name = "Cliente Nuevo";
                  else if ( user_status_data[0].name == "usuario activo" && user_stop_data.length == 0 && user_state_from_firebase == "Cliente por instalar") {
                    user_status_name = "Cliente por instalar";

                    const dateTimeEmail = false;
                    const subject_str = "Sanimapp: Requerimiento de paradero usuario #" + user_id + " " + user_name;
                    const welcome_str = "Este es un mensaje del backend. ";
                    const message_str = "Se detectó que el usuario ya está disponible para ser activo y solo requiere un paradero como mínimo.";
                    let message_container = [" [partner_id: " + user_id + "] [Name: " + user_name + "]"];
                    await FirebaseFcn.sendEmail(subject_str, welcome_str, dateTimeEmail, message_str, message_container);
                  }

                  // console.log("user_status_name: " + user_status_name);
                } else {
                  user_status_name = user_state_from_firebase;
                }
              } else { // that means in case dont have status but have a crm ticket that actual have status
                user_status_name = user_state_from_firebase;
              }

              try {
                functions.logger.info("[odooToFirebase_Users] Client_type info.", {
                  "user_id": user_id,
                  "user_status_data": user_status_data,
                  "user_route_data": user_route_data,
                  "user_stop_data": user_stop_data,
                  "user_state_from_firebase": user_state_from_firebase,
                  "user_status_name (client_type)": user_status_name,
                });
              } catch (err) {
                functions.logger.error( "[odooToFirebase_Users] Error 3101231335 (Client_type can't print): " + err);
              }


              let ubigeo = "NaN";
              // l10n_pe_ubigeo is deprecated. Using zip instead
              if (target_data[i].zip != false) ubigeo = target_data[i].zip;

              let phone1 = "NaN";
              if (target_data[i].phone != false) phone1 = target_data[i].phone;

              let phone2 = "NaN";
              if (target_data[i].mobile != false) phone2 = target_data[i].mobile;

              let name_1 = "NaN";
              if (target_data[i].first_name != false) name_1 = target_data[i].name;

              let address = "";

              if (target_data[i].street != false) address = target_data[i].street;
              if (target_data[i].street2 != false) address = address + ", " + target_data[i].street2;
              if (target_data[i].city != false) address = address + ", " + target_data[i].city;
              if (target_data[i].country_id != false) address = address + ", " + target_data[i].country_id[1];

              if (address=="") address = "NaN";

              let dni = "NaN";
              if (target_data[i].vat != false) dni = target_data[i].vat;


              // ------------------------------ GET FROM FIREBASE

              let stop_id_odoo_fromDataClient2 = 0;
              let stop_id_firebase = 0;
              let stop_name_fromDataClient2 = "NaN";

              let route_id_odoo_fromDataClient2 = 0;
              let route_id_firebase = 0;
              let route_name_fromDataClient2 = "NaN ";

              let client_type_fromDataCLient2 = "NaN";

              try {
                const dataclient2_from_FB = await FirebaseFcn.firebaseGet("Data_client/" + user_id +"/Data_client_2/" );
                stop_id_odoo_fromDataClient2 = dataclient2_from_FB["idStop"];
                stop_id_firebase = dataclient2_from_FB["stop_id_firebase"];
                stop_name_fromDataClient2 = dataclient2_from_FB["Stops"];

                route_id_odoo_fromDataClient2 = dataclient2_from_FB["idRoute"];
                route_id_firebase = dataclient2_from_FB["route_id_firebase"];
                route_name_fromDataClient2 = dataclient2_from_FB["Route"];

                client_type_fromDataCLient2 = dataclient2_from_FB["Client_Type"];

                if (dataclient2_from_FB["Stops"] == "NaN") {
                  stop_id_odoo_fromDataClient2 = 0;
                  stop_id_firebase = 0;
                  stop_name_fromDataClient2 = "NaN";


                  route_id_odoo_fromDataClient2 = 0;
                  route_id_firebase = 0;
                  route_name_fromDataClient2 = "NaN ";
                } else {
                  if (!dataclient2_from_FB["idStop"] || !dataclient2_from_FB["idRoute"] || !dataclient2_from_FB["stop_id_firebase"] || !dataclient2_from_FB["route_id_firebase"]) {
                    for (let index = 0, len = fb_stops.length; index < len; index++) {
                      if ( fb_stops[Number(keys[index])].Stops_name == dataclient2_from_FB.Stops) {
                        stop_id_odoo_fromDataClient2 = fb_stops[Number(keys[index])].idOdoo;
                        stop_id_firebase = Number(keys[index]);
                        route_name_fromDataClient2 = fb_stops[Number(keys[index])].Nom_ruta;
                        break;
                      }
                    }


                    for (let index = 0, len = fb_routes.length; index < len; index++) {
                      if ( fb_routes[Number(keys_routes[index])].Nom_ruta == route_name_fromDataClient2) {
                        route_id_odoo_fromDataClient2 = fb_routes[Number(keys_routes[index])].idOdoo;
                        route_id_firebase = Number(keys_routes[index]);


                        break;
                      }
                    }
                  }
                }
              } catch (error) {
                const dataClient_node = {
                  "Data_client_1": {
                    "Addr_reference": "NaN",
                    "Address": address,
                    "Birth_date": "000000", // Created in app
                    "Campaign_month": "NaN", // Created in app
                    "Client_Community": "NaN",
                    "Country": "Perú",
                    "DNI": dni,
                    "How_know_us": "NaN", // Created in app
                    "How_know_us_method": "NaN", // Created in Odoo
                    "How_know_us_referals": "NaN",
                    "Last_name_1": "",
                    "Last_name_2": "",
                    "Lost_client_reason": "NaN",
                    "Name_1": name_1,
                    "Name_2": "",
                    "Name_potencial": "NaN",
                    "Phone1": phone1,
                    "Phone2": phone2,
                    "Sales_person": "NaN",
                    "Sales_person_Commit": "NaN",
                    "Urine_preference": "NaN",
                    "Zone": "NaN",
                    "ubigeo": ubigeo,
                  },
                  "Data_client_2": {
                    "Client_Type": user_status_name,
                    "Group_Client_type": "Comercial",
                    "Lat": 0.0,
                    "Long": 0.0,
                    "Route": "NaN",
                    "Stops": "NaN",
                    "idRoute": 0,
                    "idStop": 0,
                    "route_id_firebase": 0,
                    "stop_id_firebase": 0,
                  },
                  "Data_client_3": {
                    "Addr": address,
                    "Addr_reference": "NaN",
                    "Name_complete": target_data[i].display_name,
                    "Phone1": phone1,
                    "Phone2": phone2,
                    "client_coment_OPE": "NaN",
                    "client_type": user_status_name,
                  },
                };

                functions.logger.info( "[odooToFirebase_Users] WARNING! There is no user in Firebase. Creating user in Data_client/" + user_id, {
                  "odoo_session": odoo_session,
                  "user_id": user_id,
                  "warning_label": true,
                });


                FirebaseFcn.firebaseSet("Data_client/" + user_id, dataClient_node);

                stop_id_odoo_fromDataClient2 = 0;
                stop_id_firebase = 0;
                stop_name_fromDataClient2 = "NaN";

                route_id_odoo_fromDataClient2 = 0;
                route_id_firebase = 0;
                route_name_fromDataClient2 = "NaN ";
              }


              // -----------------------------------------------------------------------------------------
              // Complete Data Client 2. Even if you are gonna write it.


              const initialState = {
                // State From Firebase
                "stop_id_odoo": stop_id_odoo_fromDataClient2,
                "stop_id_firebase": stop_id_firebase,
                "stop_name": stop_name_fromDataClient2,
                "route_id_odoo": route_id_odoo_fromDataClient2,
                "route_id_firebase": route_id_firebase,
                "route_name": route_name_fromDataClient2,
                "Client_Type": client_type_fromDataCLient2,


              };

              // update firebase

              let target_stopId_fb = 0;
              let target_routeId_fb = 0;

              if (user_stopId != 0) {
                for (let index = 0, len = fb_stops.length; index < len; index++) {
                  if ( fb_stops[Number(keys[index])].idOdoo == user_stopId) {
                    target_stopId_fb = Number(keys[index]);
                    user_nameroute = fb_stops[Number(keys[index])].Nom_ruta;
                    break;
                  }
                }

                for (let index = 0, len = fb_routes.length; index < len; index++) {
                  if ( fb_routes[Number(keys_routes[index])].Nom_ruta == user_nameroute) {
                    target_routeId_fb = Number(keys_routes[index]);
                    user_routeId = Number( fb_routes[Number(keys_routes[index])].idOdoo);
                    break;
                  }
                }
              }

              const targetState = {
                // State From Odoo
                "stop_id_odoo": user_stopId,
                "stop_id_firebase": target_stopId_fb,
                "stop_name": user_namestop,
                "route_id_odoo": user_routeId,
                "route_id_firebase": target_routeId_fb,
                "route_name": user_nameroute,
                "Client_Type": user_status_name,


              };
              functions.logger.info("1. targetState ", targetState);


              const ToDoList = [];
              const stops_changed = initialState.stop_id_odoo != targetState.stop_id_odoo;
              const just_routes_changed = initialOdoo_routeId != targetState.route_id_odoo && !stops_changed;
              const just_no_route = targetState.route_id_odoo == 0 && targetState.stop_id_odoo != 0 && !stops_changed;
              const state_change = targetState.Client_Type != initialState.Client_Type;
              if (stops_changed) ToDoList.push("Stops changed: " + initialState.stop_id_odoo +" -> " + targetState.stop_id_odoo);
              if ( just_routes_changed) ToDoList.push("Routes changed: " + initialOdoo_routeId +" -> " + targetState.route_id_odoo);
              if ( just_no_route ) ToDoList.push("There is no route in odoo");
              if (state_change) ToDoList.push("State changed: " + initialState.Client_Type + " -> " + targetState.Client_Type);
              if (!stops_changed && !just_no_route && ! just_routes_changed && !state_change) ToDoList.push("Nothing to do.");


              functions.logger.info("1. ToDoList ", ToDoList);


              // fast solution
              if (state_change) {
                // update change in firebase
                try {
                  let status_address2 = "Data_client/" + user_id +"/Data_client_2/Client_Type";
                  let status_address3 = "Data_client/" + user_id +"/Data_client_3/client_type";

                  await FirebaseFcn.firebaseSet(status_address2, targetState.Client_Type );
                  await FirebaseFcn.firebaseSet(status_address3, targetState.Client_Type );

                  functions.logger.info("states updated");
                } catch (error) {
                  functions.logger.error("states not updated. ", error);
                }
              } else {
                console.log("states not changed " + targetState.Client_Type +"initialState.Client_Type" + initialState.Client_Type);
              }


              functions.logger.info( "[odooToFirebase_Users] Tasks. ",
                  {
                    "odoo_session": odoo_session,
                    "user_id": user_id,
                    "to-do-list": ToDoList,
                    "initialState": initialState,
                    "targetState": targetState,

                  });


              info = {
                "odoo_session": odoo_session,
                "user_id": user_id,
                "stop_id_odoo": user_stopId,
                "stop_id_firebase": target_stopId_fb,
                "stop_name": user_namestop,
                "route_id_odoo": user_routeId,
                "route_id_firebase": target_routeId_fb,
                "route_name": user_nameroute,
              };

              if ( stops_changed) {
                // 1 update route in odoo
                // 2 update data client 2
                // 3 update route colection , delete user from initial route and add it in target route
                // 4 update route definitions , delete user from initial route and add it in target route
                // 5 update stops  , delete user from initial stop and add it in

                // -----------------------------(1)-----------------------------------
                // First, delete the route from the categories array
                const index_category = user_categories.indexOf(initialOdoo_routeId);
                if (index_category != -1 ) user_categories.splice( index_category, 1);

                user_categories.push(targetState.route_id_odoo);

                try {
                  functions.logger.info( "[odooToFirebase_Users] updating route in Odoo.", info);

                  const raw = JSON.stringify({
                    "params": {
                      "model": "res.partner",
                      "method": "write",
                      "kwargs": {},
                      "args": [user_id,
                        {
                          "category_id": user_categories,
                        }],
                    },
                  });

                  const params = {
                    headers: CustomHeaders,
                    method: "post",
                    body: raw,
                  };

                  await fetch(settings.odoo_url + "dataset/call_kw/res.partner/write", params);
                } catch (err) {
                  functions.logger.error( "[odooToFirebase_Users] Error updating route in Odoo: " + err, info);
                }

                // -----------------------------(2)-----------------------------------
                // 2 update data client 2
                const dataclient2_address = "Data_client/" + user_id +"/Data_client_2/";
                const data_client2_json = {
                  "idStop": targetState.stop_id_odoo,
                  "Stops": targetState.stop_name,
                  "idRoute": targetState.route_id_odoo,
                  "Route": targetState.route_name,
                  "route_id_firebase": targetState.route_id_firebase,
                  "stop_id_firebase": targetState.stop_id_firebase,
                };

                try {
                  const res = await FirebaseFcn.firebaseUpdate(dataclient2_address, data_client2_json );
                  if (res == true) functions.logger.info( "[odooToFirebase_Users] updating user in Firebase ("+ dataclient2_address +") from Odoo. ", info );
                  else {
                    functions.logger.error( "[odooToFirebase_Users] Error updating user ("+ dataclient2_address+ "): " + res, {
                      "odoo_session": odoo_session,
                      "user_id": user_id});
                  }
                } catch (err) {
                  functions.logger.error( "[odooToFirebase_Users] Error updating Data_client_2 in Firebase: ("+ dataclient2_address +"): " + err, {
                    "odoo_session": odoo_session,
                    "user_id": user_id} );
                }

                // -----------------------------(3)-----------------------------------
                // 3 update route colection , delete user from initial route and add it in target route
                const routesCollection_address = "Routes_collection/" + targetState.route_id_firebase+ "/"+ targetState.stop_id_firebase +"/"+ user_id;
                const routes_collection_json = {
                  "Just_complete_name": target_data[i].display_name,
                  "client_coment_OPE": "NaN",
                };

                // Adding
                try {
                  if (targetState.route_id_firebase != 0) {
                    const res = await FirebaseFcn.firebaseUpdate(routesCollection_address, routes_collection_json );
                    if (res == true) functions.logger.info( "[odooToFirebase_Users] updating user in Routes_collection ("+ routesCollection_address +") from Odoo. ", info );
                    else {
                      functions.logger.error( "[odooToFirebase_Users] Error updating user in Routes_collection ("+ routesCollection_address+ "): " + res, {
                        "odoo_session": odoo_session,
                        "user_id": user_id});
                    }
                  }
                } catch (err) {
                  functions.logger.error( "[odooToFirebase_Users] Error updating Routes_collection in Firebase: ("+ dataclient2_address +"): " + err, {
                    "odoo_session": odoo_session,
                    "user_id": user_id} );
                }
                // deleting
                const routesCollection_address_delete = "Routes_collection/" + initialState.route_id_firebase+ "/"+ initialState.stop_id_firebase +"/"+ user_id;
                try {
                  if (initialState.route_id_firebase != 0) {
                    const RC_StopAddress = "Routes_collection/" + initialState.route_id_firebase + "/" + initialState.stop_id_firebase;
                    const routeCollData = await FirebaseFcn.firebaseGet(RC_StopAddress);
                    const keys_RTD = Object.keys(routeCollData);

                    const res = await FirebaseFcn.firebaseRemove(routesCollection_address_delete);
                    if (res == true) {
                      functions.logger.info( "[odooToFirebase_Users] deleting initial stop in Routes_collection ("+ routesCollection_address_delete +") from Odoo. ", info );
                      if (keys_RTD.length === 1) await FirebaseFcn.firebaseSet(RC_StopAddress, false);
                    } else {
                      functions.logger.error( "[odooToFirebase_Users] Error deleting initial stop in Routes_collection ("+ routesCollection_address_delete+ "): " + res, {
                        "odoo_session": odoo_session,
                        "user_id": user_id});
                    }
                  }
                } catch (err) {
                  functions.logger.error( "[odooToFirebase_Users] Error deleting initial stop in Routes_collection ("+ routesCollection_address_delete +"): " + err, {
                    "odoo_session": odoo_session,
                    "user_id": user_id} );
                }

                // -----------------------------(4)-----------------------------------
                // 4 update route definitions , delete user from initial route and add it in target route
                // se supone que si el paradero ha sido modificado de ruta, esto ya esta en el nodo de route definition.

                const routesDefinition_address = "Route_definition/" + targetState.route_id_firebase+"/partnersId/";

                // deleting
                const routesDefinition_address_delete = "Route_definition/" + initialState.route_id_firebase+ "/partnersId/"+ user_id;
                try {
                  if (initialState.route_id_firebase != 0) {
                    const res = await FirebaseFcn.firebaseRemove(routesDefinition_address_delete);
                    if (res == true) functions.logger.info( "[odooToFirebase_Users] deleting user in initial stop in Route_definition ("+ routesDefinition_address_delete +") from Odoo. ", info );
                    else {
                      functions.logger.error( "[odooToFirebase_Users] Error deleting user in initial stop in Route_definition ("+ routesDefinition_address_delete+ "): " + res, {
                        "odoo_session": odoo_session,
                        "user_id": user_id});
                    }
                  }
                } catch (err) {
                  functions.logger.error( "[odooToFirebase_Users] Error deleting user in initial stop in Route_definition ("+ routesDefinition_address_delete +"): " + err, {
                    "odoo_session": odoo_session,
                    "user_id": user_id} );
                }

                // Adding
                try {
                  if (targetState.route_id_firebase != 0) {
                    const map = new Map();
                    map.set(user_id, true);
                    const firebase_json = Object.fromEntries(map);
                    const res = await FirebaseFcn.firebaseUpdate(routesDefinition_address, firebase_json );
                    if (res == true) functions.logger.info( "[odooToFirebase_Users] updating user "+ user_id+" in Route_definition ("+ routesDefinition_address +") from Odoo. ", info );
                    else {
                      functions.logger.error( "[odooToFirebase_Users] Error updating user "+ user_id+" in Route_definition ("+ routesDefinition_address+ "): " + res, {
                        "odoo_session": odoo_session,
                        "user_id": user_id});
                    }
                  }
                } catch (err) {
                  functions.logger.error( "[odooToFirebase_Users] Error updating user "+ user_id+"  in Route_definition in Firebase: ("+ routesDefinition_address +"): " + err, {
                    "odoo_session": odoo_session,
                    "user_id": user_id} );
                }

                // -----------------------------(5 )-----------------------------------
                // 5 update stops  , delete user from initial stop and add it in
                // deleting
                const stops_address_delete = "stops/" + initialState.stop_id_firebase+ "/partnersId/"+ user_id;
                try {
                  if (initialState.stop_id_firebase != 0) {
                    const res = await FirebaseFcn.firebaseRemove(stops_address_delete);
                    if (res == true) functions.logger.info( "[odooToFirebase_Users] deleting user "+ user_id+" in initial stop ("+ stops_address_delete +") from Odoo. ", info );
                    else {
                      functions.logger.error( "[odooToFirebase_Users] Error deleting user "+ user_id+" in initial stop ("+ routesDefinition_address_delete+ "): " + res, {
                        "odoo_session": odoo_session,
                        "user_id": user_id});
                    }
                  }
                } catch (err) {
                  functions.logger.error( "[odooToFirebase_Users] Error deleting user "+ user_id+" in initial stop  ("+ routesDefinition_address_delete +"): " + err, {
                    "odoo_session": odoo_session,
                    "user_id": user_id} );
                }

                // Adding
                const stops_address = "stops/" + targetState.stop_id_firebase+"/partnersId/";
                try {
                  if (targetState.stop_id_firebase != 0) {
                    const map = new Map();
                    map.set(user_id, true);
                    const firebase_json = Object.fromEntries(map);
                    const res = await FirebaseFcn.firebaseUpdate(stops_address, firebase_json );
                    if (res == true) functions.logger.info( "[odooToFirebase_Users] updating user "+ user_id+" in target stop in Firebase ("+ stops_address +") from Odoo. ", info );
                    else {
                      functions.logger.error( "[odooToFirebase_Users] Error updating user "+ user_id+" in target stop in Firebase ("+ stops_address+ "): " + res, {
                        "odoo_session": odoo_session,
                        "user_id": user_id});
                    }
                  }
                } catch (err) {
                  functions.logger.error( "[odooToFirebase_Users] Error updating user "+ user_id+"  in target stop in Firebase: ("+ stops_address +"): " + err, {
                    "odoo_session": odoo_session,
                    "user_id": user_id} );
                }
              }

              if (just_routes_changed ) {
                // -----------------------------(1)-----------------------------------
                // First, delete the route from the categories array
                const index_category = user_categories.indexOf(initialOdoo_routeId);
                if (index_category != -1 ) user_categories.splice( index_category, 1);

                user_categories.push(targetState.route_id_odoo);

                try {
                  functions.logger.info( "[odooToFirebase_Users] updating route in Odoo.", info);

                  const raw = JSON.stringify({
                    "params": {
                      "model": "res.partner",
                      "method": "write",
                      "kwargs": {},
                      "args": [user_id,
                        {
                          "category_id": user_categories,
                        }],
                    },
                  });

                  const params = {
                    headers: CustomHeaders,
                    method: "post",
                    body: raw,
                  };

                  await fetch(settings.odoo_url + "dataset/call_kw/res.partner/write", params);
                } catch (err) {
                  functions.logger.error( "[odooToFirebase_Users] Error updating route in Odoo: " + err, info);
                }
              }

              if (just_no_route ) {
                functions.logger.info("just_no_route");
              }

              if (warning_list_map.has(String(user_id))) {
                functions.logger.info("the user ", user_id, " is on the warning list and its correct. attempting to delete it");
                warning_list_map.delete(String(user_id));
              }

              count_correct = count_correct + 1;
            } else {
              functions.logger.info( "[odooToFirebase_Users] User " + user_id + " ignored due ilegal move.", {
                "odoo_session": odoo_session,
                "user_id": user_id,
                "warning_label": "illegal",
              });
            }
          } catch (error) {
            functions.logger.error( "[odooToFirebase_Users] ERROR: in legal task, error updating user " + user_id, {
              "odoo_session": odoo_session,
              "user_id": user_id,
            } );
          }
        } catch (error) {
          functions.logger.error( "[odooToFirebase_Users] ERROR: error updating user " + user_id, {
            "odoo_session": odoo_session,
            "user_id": user_id,
            "odoo_query_time": odoo_query_time,
            "write_date": target_data[i].write_date,

          } );
          FirebaseFcn.firebaseSet("/Backend/Errors/odooToFirebase_Users/"+user_id, {
            "odoo_session": odoo_session,
            "user_id": user_id,
            "target_userCategories": user_categories,
          } );
        }
      }

      if (qtty_users<max_qtty_entries_per_session ) odoo_query_time = Date.now();


      console.log( "warning_list_map", warning_list_map);

      console.log("count_correct", count_correct);
      console.log("count_incorrect", warning_list.length);


      FirebaseFcn.firebaseSet("/timestamp_collection/ussersTimeStamp", String(odoo_query_time));
      functions.logger.info( "[odooToFirebase_Users] updating ussersTimeStamp in Firebase", {
        "odoo_session": odoo_session,
        "userTimestamp": String(odoo_query_time),
      } );


      const warning_list_json = Object.fromEntries(warning_list_map);
      FirebaseFcn.firebaseSet("illegal_entries_stack", warning_list_json);

      if (warning_list.length > 0) {
        const dateTimeEmail = Date.now()-18000000;
        const subject_str = " Sanimapp Backend Alert";
        // const welcome_str = "Esta es una alerta generada el ";
        const message_str = "Se han ignorados los siguientes ingresos ( Odoo timestamp: "+lastupdateTimestamp+" ["+ date_str +"] ). Por favor, revisarlos a la brevedad.";
        // await FirebaseFcn.sendEmail(subject_str, welcome_str, dateTimeEmail, message_str, warning_list);
        functions.logger.info( "[odooToFirebase_Users] "+ subject_str, {
          "odoo_session": odoo_session,
          "dateTimeEmail": String(dateTimeEmail),
          "message_str": message_str,
        } );
      }
    } // else functions.logger.info( "[odooToFirebase_Users] No update founded in Odoo.", {"odoo_session": odoo_session});
  } catch (err) {
    functions.logger.error( "[odooToFirebase_Users] ERROR: " + err, {"odoo_session": odoo_session} );
    return false;
  }

  return true;
}

export async function odooToFirebase_Campaigns(odoo_session:any, lastupdateTimestamp: any) {
  const date = new Date(Number(lastupdateTimestamp));
  const date_str = "'"+ date.getFullYear()+"-"+("0" + (date.getMonth() + 1)).slice(-2)+"-"+("0" +date.getDate()).slice(-2)+" "+ ("0" +date.getHours()).slice(-2)+":"+("0" +date.getMinutes()).slice(-2)+":"+("0" +date.getSeconds()).slice(-2) + "'";

  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  const raw = JSON.stringify({
    "params": {
      "model": "utm.campaign",
      "offset": 0,
      "fields": ["display_name"],
      "domain": [["write_date", ">", date_str]],
    },
  });

  const params = {
    headers: CustomHeaders,
    method: "post",
    body: raw,
  };

  let response;
  let data;
  let target_data;
  let odoo_res = false;

  try {
    response = await fetch(settings.odoo_url + "dataset/search_read", params);
    data = await response.json();
    target_data = data["result"]["records"];

    odoo_res = true;
  } catch (error) {
    functions.logger.error("[odooToFirebase_Campaigns] Odoo request Error: ", {
      "odoo_session": odoo_session,
    });
    odoo_res = false;
    return false;
  }

  let res;

  if (target_data.length == 0) {
    true;
    // functions.logger.info( "[odooToFirebase_Campaigns] Campaings no needed to be updated.");
  } else {
    functions.logger.info("[odooToFirebase_Campaigns] Se ejecutó el siguiente query.", {"odoo_session": odoo_session, "raw": raw});

    res = false;

    try {
      if (odoo_res) {
        if (response?.status == 200) {
          const map = new Map();
          let id : any;
          let name : string;


          for (let i = 0, len = target_data.length; i < len; i++) {
            id = target_data[i]["id"];
            name = target_data[i]["display_name"];

            map.set(id, name);
          }

          const firebase_json = Object.fromEntries(map);
          res = await FirebaseFcn.firebaseUpdate("campaign_names", firebase_json);

          if (!res) {
            functions.logger.error("[odooToFirebase_Campaigns] Campaings : Firebase failure updating " + target_data.length + " records.", {
              "odoo_session": odoo_session,
              "target_data": target_data});
          }
        } else {
          functions.logger.error("[odooToFirebase_Campaigns] Odoo request Error: " + response?.status, {
            "odoo_session": odoo_session,
            "target_data": target_data,
          });
        }
      }
    } catch (error) {
      functions.logger.error( "[odooToFirebase_Campaigns] No Firebase updated so any campaign updated", {
        "odoo_session": odoo_session,
        "target_data": target_data,
      });
      return false;
    }
  }

  try {
    if (res) {
      const dateTime = Date.now();
      FirebaseFcn.firebaseSet("/timestamp_collection/CMR_campaings_timestamp", String(dateTime));

      const new_date = new Date(Number(dateTime));
      const new_date_str = "'"+ new_date.getFullYear()+"-"+("0" + (new_date.getMonth() + 1)).slice(-2)+"-"+("0" +new_date.getDate()).slice(-2)+" "+ ("0" +new_date.getHours()).slice(-2)+":"+("0" +new_date.getMinutes()).slice(-2)+":"+("0" +new_date.getSeconds()).slice(-2) + "'";


      functions.logger.info( "[odooToFirebase_Campaigns] Campaings succesful updated.", {
        "odoo_session": odoo_session,
        "target_data": target_data,
        "CMR_campaings_timestamp": lastupdateTimestamp,
        "CMR_campaings_timestamp_str": date_str,
        "New CMR_campaings_timestamp": String(dateTime),
        "New CMR_campaings_timestamp_str": new_date_str,
      } );
    }
  } catch (error) {
    functions.logger.error( "[odooToFirebase_Campaigns] No CMR_campaings_timestamp updated", {
      "odoo_session": odoo_session,
      "target_data": target_data,
    });
    return false;
  }

  return true;
}

export async function odooToFirebase_ServiceTickets(odoo_session:any, lastupdateTimestamp: any) {
  let odoo_query_time = Date.now(); // THIS IS THE TIME WHERE I MADE THE CHECK
  // const max_qtty_entries_per_session = 200;


  // The function reads the tickes of service created in odoo after the last update
  const date = new Date(Number(lastupdateTimestamp));
  const date_str = "'"+ date.getFullYear()+"-"+("0" + (date.getMonth() + 1)).slice(-2)+"-"+("0" +date.getDate()).slice(-2)+" "+ ("0" +date.getHours()).slice(-2)+":"+("0" +date.getMinutes()).slice(-2)+":"+("0" +date.getSeconds()).slice(-2) + "'";

  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  const raw = JSON.stringify({
    "params": {
      "model": "helpdesk.ticket",
      "offset": 0,
      "fields": ["create_date", "partner_id", "description", "name", "stage_id", "tag_ids", "write_date"],
      "domain": [["write_date", ">", date_str]],
    },
  });

  const params = {
    headers: CustomHeaders,
    method: "call",
    body: raw,
  };

  try {
    const response = await fetch(settings.odoo_url + "dataset/search_read/", params);
    const data = await response.json();
    const qtty_entries = data.result.length;
    if (qtty_entries>0) {
      functions.logger.info("[odooToFirebase_ServiceTickets] Se ejecutó el siguiente query.", {"odoo_session": odoo_session, "raw": raw});

      const serviceColletion= await FirebaseFcn.firebaseGet("/Service_collection");

      const len = max_qtty_entries_per_session > qtty_entries ? qtty_entries : max_qtty_entries_per_session;
      console.log(qtty_entries, len, max_qtty_entries_per_session);


      // Only works if there is at least a new ticket

      const servCollKeys = Object.keys(serviceColletion); // list of tickets ids in Firebase

      // console.log("servCollKeys", servCollKeys);
      let entries = data.result.records;
      let tickets = entries.sort((e:any, f:any) => Date.parse(e.write_date) - Date.parse(f.write_date));

      tickets = tickets.slice(0, len);

      functions.logger.info( "[odooToFirebase_ServiceTickets] Entries Found : target_data (sorted)", {
        "target_data (sorted)": tickets,
        "qtty_entries": qtty_entries,
        "max_qtty_entries_per_session": max_qtty_entries_per_session,
        "len": len,
        "date_str": date_str,


      });

      for (let i = 0; i < len; i++) {
        const ticket = tickets[i];
        const id = String(ticket["id"]);
        odoo_query_time = Date.parse(ticket.write_date);


        try {
          let user_data = await get_user_data(odoo_session, ticket["partner_id"][0], 0);

          functions.logger.info( "[odooToFirebase_ServiceTickets] Ticket #" + (i + 1) +": "+ ticket["partner_id"][0], {
            "odoo_session": odoo_session,
            "ticket": ticket,
            "user_data": user_data,
          });

          // save the data readed from odoo, organizing it to write in Firebase
          const create_date = Date.parse(ticket["create_date"]);
          const creation_date = new Date(Number(create_date)-18000000);
          const create_date_str = creation_date.getFullYear()+"-"+("0" + (creation_date.getMonth() + 1)).slice(-2)+"-"+("0" +creation_date.getDate()).slice(-2)+" "+ ("0" +creation_date.getHours()).slice(-2)+":"+("0" +creation_date.getMinutes()).slice(-2)+":"+("0" +creation_date.getSeconds()).slice(-2);

          const partner_id = String(ticket["partner_id"][0]);
          const description = ticket["description"];
          const name = ticket["name"];


          const stage_id = Number(ticket["stage_id"][0]);
          // stage_id defines ticket status acording the relation below

          console.log("stage_id", stage_id);

          let ticket_status = "NaN";
          switch (stage_id) { // from odoo
            case 1:
              ticket_status = "Nuevo";
              break;
            case 2:
              ticket_status = "En progreso";
              break;
            case 14:
              ticket_status = "Terminado";
              break;
            default:
              break;
          }

          const tag_ids = ticket["tag_ids"];
          // tag_ids defines ticket type acording the relation below
          let ticket_type = "NaN";
          if (tag_ids.includes(26)) ticket_type = "Asistencia Técnica";
          if (tag_ids.includes(4)) ticket_type = "Asistencia Técnica";
          if (tag_ids.includes(278)) ticket_type = "Instalación"; // before 14
          if (tag_ids.includes(16)) ticket_type = "Desinstalación";
          if (tag_ids.includes(102)) ticket_type = "Conversión Eléctrica";
          if (tag_ids.includes(107)) ticket_type = "Desconexión Eléctrica";
          if (tag_ids.includes(49)) ticket_type = "Instalación Urinario";

          // console.log("servCollKeys.includes(id) ", servCollKeys.includes(id), {servCollKeys});
          // Use saved data to write in firebase depending on each case
          if (servCollKeys.includes(id)) {// **************************************************************************************
            // if ticket already exists in Firebase (Service_Collection) then just update some params
            // The updating depends on the current ticket status in firebase and the new ticket status from odoo

            const initialState = await FirebaseFcn.firebaseGet("/Service_collection/" + id);

            // console.log("initialState", initialState);

            const targetState = initialState;

            // if ticket status is "Nuevo"--------------------------------------------------------------------------------------
            if (ticket_status === "Nuevo" && ticket_type == "Instalación") {
              await modify_state_user(odoo_session, user_data, 453, "add" );

              await modify_state_user(odoo_session, user_data, 358, "remove" );
              // just update if the current status is "Nuevo"
              if (initialState["ticket_status"] != "Nuevo") {
                targetState["id_client"] = Number(partner_id);
                targetState["ticket_commits"] = description;
                targetState["ticket_name"] = name;
                targetState["ticket_status"] = ticket_status;
                targetState["ticket_type"] = ticket_type;
              }
            }

            // if ticket status is "En progreso"--------------------------------------------------------------------------------
            if (ticket_status === "En progreso" && ticket_type == "Instalación") {
              await modify_state_user(odoo_session, user_data, 453, "add" );

              await modify_state_user(odoo_session, user_data, 358, "remove" );
              // just update if the current status is "Nuevo" or "En progreso"

              // If "Nuevo"
              if (initialState["ticket_status"] != "En progreso") {
                targetState["id_client"] = Number(partner_id);
                targetState["ticket_commits"]= description;
                targetState["ticket_name"] = name;
                targetState["ticket_status"] = ticket_status;
                targetState["ticket_type"] = ticket_type;
                targetState["conflict_indicator"]= "Actualizado por Odoo";

                if (initialState["install_timestamp"] == null) {
                  const dateTimeEmail = false;
                  const subject_str = "Sanimapp: [ADVERTENCIA] Ticket de instalación #" + id + " [EN PROGRESO] ("+ name;
                  const welcome_str = "Este es un mensaje del backend. ";
                  const message_str = "Se registró ticket de instalación como En Progreso, sin embargo no cuenta con una hora de instalación, por favor realize el cambio por el app. Antes devuelvalo a Nuevo. ";
                  let message_container = ["[helpdesk_id: " + id + "] [partner_id: " + partner_id + "] [Name: " + name + "]"];
                  await FirebaseFcn.sendEmail(subject_str, welcome_str, dateTimeEmail, message_str, message_container);
                }
              }
            }

            // if ticket status is "Terminado"-----------------------------------------------------------------------------------
            if (ticket_status === "Terminado") {
              // just update if the current status is "Nuevo" or "En progreso"
              if (ticket_type == "Instalación") {
                await modify_state_user(odoo_session, user_data, 453, "remove" );

                await modify_state_user(odoo_session, user_data, 358, "add" );

                // tentative to turn here Cliente nuevo in firebase

                const dateTimeEmail = false;
                const subject_str = "Sanimapp: Ticket de instalación #" + id + " [TERMINADO] ("+ name;
                const welcome_str = "Este es un mensaje del backend. ";
                const message_str = "Se registró ticket de instalación como terminado. El usuario se encuentra como activo, añadir al menos un paradero. ";
                let message_container = ["[helpdesk_id: " + id + "] [partner_id: " + partner_id + "] [Name: " + name + "]"];
                await FirebaseFcn.sendEmail(subject_str, welcome_str, dateTimeEmail, message_str, message_container);
              } else {
                const dateTimeEmail = false;
                const subject_str = "Sanimapp: Ticket de "+ ticket_type +" #" + id + " [TERMINADO] ("+ name;
                const welcome_str = "Este es un mensaje del backend. ";
                const message_str = "Se registró ticket de "+ ticket_type +" como terminado.  ";
                let message_container = ["[helpdesk_id: " + id + "] [partner_id: " + partner_id + "] [Name: " + name + "]"];
                await FirebaseFcn.sendEmail(subject_str, welcome_str, dateTimeEmail, message_str, message_container);
              }

              // If "Nuevo" or en progreso
              if (serviceColletion[id]["ticket_status"] != "Terminado") {
                targetState["id_client"] = Number(partner_id);
                targetState["ticket_commits"] = description;
                targetState["ticket_name"] = name;
                targetState["ticket_status"] = ticket_status;
                targetState["ticket_type"] = ticket_type;

                await FirebaseFcn.firebaseRemove("/Service_collection/" + id);
                functions.logger.info( "[odooToFirebase_ServiceTickets] Ticket removed from Firebase (/Service_collection/" + id +").", {
                  "ticket_id": id,
                  "ticket_type": ticket_type,
                  "initialState": initialState,
                  "targetState": targetState,
                });
              }
            }
            // // if ticket status is "NaN"--------------------------------------------------------------------------------------
            // if (ticket_status === "NaN") {
            //   functions.logger.info( "[odooToFirebase_ServiceTickets] Tasks. ", {
            //     "odoo_session": odoo_session,
            //     "ticket_id": id,
            //     "to-do-list": ["Remove ticket from Firebase. Ticket status not defined"],
            //     "initialState": initialState,
            //     "stage_id": stage_id,
            //   });
            //   await FirebaseFcn.firebaseRemove("/Service_collection/" + id);
            //   functions.logger.info( "[odooToFirebase_ServiceTickets] Ticket removed from Firebase (/Service_collection/" + id +").", {
            //     "ticket_id": id,
            //     "initialState": initialState,
            //     "stage_id": stage_id,
            //   });
            // }

            // if ticket status is "NaN"--------------------------------------------------------------------------------------
            if (ticket_status === "NaN") {
              functions.logger.info( "[odooToFirebase_ServiceTickets] Tasks. ", {
                "odoo_session": odoo_session,
                "ticket_id": id,
                "to-do-list": ["Remove ticket from Firebase. Ticket status not defined"],
                "initialState": initialState,
                "stage_id": stage_id,
              });
              await FirebaseFcn.firebaseRemove("/Service_collection/" + id);
              functions.logger.info( "[odooToFirebase_ServiceTickets] Ticket removed from Firebase (/Service_collection/" + id +").", {
                "ticket_id": id,
                "initialState": initialState,
                "stage_id": stage_id,
              });
            }

            // console.log( "[odooToFirebase_ServiceTickets] target state is  ", targetState);

            if (initialState != targetState) {
              functions.logger.info( "[odooToFirebase_ServiceTickets] Tasks. ", {
                "odoo_session": odoo_session,
                "ticket_id": id,
                "to-do-list": ["Update ticket in firebase"],
                "initialState": initialState,
                "targetState": targetState,
              });

              await FirebaseFcn.firebaseUpdate("/Service_collection/" + id, targetState);
              functions.logger.info( "[odooToFirebase_ServiceTickets] Ticket updated in Firebase (/Service_collection/" + id +").", {
                "ticket_id": id,
                "initialState": initialState,
                "targetState": targetState,
              });
            } else {
              functions.logger.info( "[odooToFirebase_ServiceTickets] Tasks. ", {
                "odoo_session": odoo_session,
                "ticket_id": id,
                "to-do-list": ["Nothing to do."],
                "initialState": initialState,
                "targetState": targetState,
              });
            }
          } else { // *********************************************************************************************************
            // if ticket doesnt exist in firebase, then create value with params
            const ToDoList = [];

            if (ticket_type === "Instalación") ToDoList.push("Update client type in Firebase");

            // It only creates tickes with valid ticket typer"------------------------------------------------------------------
            if (ticket_type != "NaN") {
              ToDoList.push("Create ticket in Firebase");

              const targetState = {
                "id_client": Number(partner_id),
                "creation_timestamp": create_date_str,
                "ticket_commits": description,
                "ticket_name": name,
                "ticket_status": ticket_status,
                "ticket_type": ticket_type,
                "conflict_indicator": "NaN",
                "install_timestamp": "NaN",
              };

              // just create if the new status is "Nuevo" or "En progreso"

              // If "Nuevo"
              if (ticket_status === "Nuevo") {
                functions.logger.info( "[odooToFirebase_ServiceTickets] Tasks. ", {
                  "odoo_session": odoo_session,
                  "ticket_id": id,
                  "to-do-list": ToDoList,
                  "initialState": [],
                  "targetState": targetState,
                });
                await FirebaseFcn.firebaseUpdate("/Service_collection/" + id, targetState);
                functions.logger.info( "[odooToFirebase_ServiceTickets] Ticket created in Firebase (/Service_collection/" + id +").", {
                  "odoo_session": odoo_session,
                  "ticket_id": id,
                  "to-do-list": ToDoList,
                  "initialState": [],
                  "targetState": targetState,
                });
              }

              // If "En progreso"
              if (ticket_status === "En progreso") {
                targetState["conflict_indicator"] = "Creado en Odoo";
                functions.logger.info( "[odooToFirebase_ServiceTickets] Tasks. ", {
                  "odoo_session": odoo_session,
                  "ticket_id": id,
                  "to-do-list": ToDoList,
                  "initialState": [],
                  "targetState": targetState,
                });
                await FirebaseFcn.firebaseUpdate("/Service_collection/" + id, targetState);
                functions.logger.info( "[odooToFirebase_ServiceTickets] Ticket created in Firebase (/Service_collection/" + id +").", {
                  "odoo_session": odoo_session,
                  "ticket_id": id,
                  "to-do-list": ToDoList,
                  "initialState": [],
                  "targetState": targetState,
                });

                const dateTimeEmail = false;
                const subject_str = "Sanimapp: [ADVERTENCIA] Ticket de instalación #" + id + " [EN PROGRESO] ("+ name;
                const welcome_str = "Este es un mensaje del backend. ";
                const message_str = "Se registró ticket de instalación como En Progreso, siendo creado directamente en Odoo sin haber pasado como Nuevo en Firabse, no cuenta con información de fecha y hora o comentario, la cual se crearía en el App";
                let message_container = ["[helpdesk_id: " + id + "] [partner_id: " + partner_id + "] [Name: " + name + "]"];
                await FirebaseFcn.sendEmail(subject_str, welcome_str, dateTimeEmail, message_str, message_container);
                // */
              }

              // In case, ticket type is install, it alse updates the client type in Firebase to "cliente por instalar"---------
              if (ticket_type === "Instalación") {
                const client_type_old_2 = await FirebaseFcn.firebaseGet("/Data_client/"+partner_id+"/Data_client_2/Client_Type");
                const client_type_old_3 = await FirebaseFcn.firebaseGet("/Data_client/"+partner_id+"/Data_client_3/client_type");
                await FirebaseFcn.firebaseSet("/Data_client/"+partner_id+"/Data_client_2/Client_Type", "Cliente por instalar");
                await FirebaseFcn.firebaseSet("/Data_client/"+partner_id+"/Data_client_3/client_type", "Cliente por instalar");
                functions.logger.info( "[odooToFirebase_ServiceTickets] Client type updated in Firebase (/Data_client/"+partner_id+")", {
                  "ticket_id": id,
                  "id_client": Number(partner_id),
                  "Old Client Type (Data_client_2)": client_type_old_2,
                  "New Client Type (Data_client_2)": "Cliente por instalar",
                  "Old client type (Data_client_3)": client_type_old_3,
                  "New client type (Data_client_3)": "Cliente por instalar",
                });
              }
            } else {
              functions.logger.info( "[odooToFirebase_ServiceTickets] Tasks. ",
                  {
                    "odoo_session": odoo_session,
                    "ticket_id": id,
                    "to-do-list": ["Nothing to do."],

                  });
              functions.logger.info("[odooToFirebase_ServiceTickets] Ticket not read. Ticket type not defined", {
                "odoo_session": odoo_session,
                "ticket_id": id,
                "tags_ids": tag_ids,
              });
            }
          }
        } catch (err) {
          functions.logger.error("[odooToFirebase_ServiceTickets] ERROR: " + err, {
            "odoo_session": odoo_session,
            "ticket_id": id,
            "odoo_query_time": odoo_query_time,
            "write_date": ticket[i].write_date,

          });
        }
      }
      if (len<max_qtty_entries_per_session ) odoo_query_time = Date.now();
    } // else functions.logger.info( "[odooToFirebase_ServiceTickets] No service tickets founded in Odoo.", {"odoo_session": odoo_session});

    // change last odoo_query_time to Date.now() when i == len and len < max_qtty_query


    FirebaseFcn.firebaseSet("/timestamp_collection/tickets_timestamp", String(odoo_query_time));
    functions.logger.info( "[odooToFirebase_ServiceTickets] updating tickets_timestamp in Firebase", {
      "odoo_session": odoo_session,
      "tickets_timestamp": String(odoo_query_time),
    } );
    return true;
  } catch (err) {
    functions.logger.error("[odooToFirebase_ServiceTickets] ERROR: " + err, {"odoo_session": odoo_session} );
  }
  return false;
}

export async function is_there_install_serviceTicket(odoo_session:any, user_id: any) {
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  const raw = JSON.stringify({
    "params": {
      "model": "helpdesk.ticket",
      "offset": 0,
      "fields": ["partner_id"],
      "domain": ["&", ["partner_id", "=",
        user_id], ["tag_ids", "=", 278]], // before 14
    },
  });

  const params = {
    headers: CustomHeaders,
    method: "call",
    body: raw,
  };

  try {
    const response = await fetch(settings.odoo_url + "dataset/search_read/", params);
    const data = await response.json();
    const qtty_entries = data.result.length;
    if (qtty_entries>0) {
      functions.logger.info("[is_there_install_serviceTicket] Existe un ticket de instalacion.",
          {"odoo_session": odoo_session, "ticket_id ": data.result.records.id});


      return true;
    }
  } catch (err) {
    functions.logger.error("[is_there_install_serviceTicket] ERROR. It seems there is no installation ticket " + err, {"odoo_session": odoo_session} );
  }
  return false;
}


export async function odooToFirebase_CRMTickets(odoo_session:any, lastupdateTimestamp: any) {
  let odoo_query_time = Date.now();// THIS IS THE TIME WHERE I MADE THE CHECK

  // The function reads the tickes CRM created in odoo after the last update
  const date = new Date(Number(lastupdateTimestamp));
  const date_str = "'"+ date.getFullYear()+"-"+("0" + (date.getMonth() + 1)).slice(-2)+"-"+("0" +date.getDate()).slice(-2)+" "+ ("0" +date.getHours()).slice(-2)+":"+("0" +date.getMinutes()).slice(-2)+":"+("0" +date.getSeconds()).slice(-2) + "'";

  // const listOfTypesVentas = ["Cliente Potencial", "Cliente con firma", "Cliente ganado", "Cliente con Venta perdida"]


  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  const raw = JSON.stringify({
    "params": {
      "model": "crm.lead",
      "offset": 0,
      "fields": [
        "id", "partner_id", "campaign_id", "stage_id", "medium_id", "source_id", "referred",
        "name", "phone", "mobile", "tag_ids", "create_uid", "create_date", "write_date", "street", "street2", "zip", "country_id", "state_id", "tag_ids", "user_id",

      ],
      "domain": ["&", ["write_date", ">", date_str], ["partner_id", "!=", false]],
    },
  });

  // sales person is user_id

  const params = {
    headers: CustomHeaders,
    method: "call",
    body: raw,
  };

  let invoice_reference_stack_keys :any[] = [];
  let invoice_reference_stack;
  try {
    invoice_reference_stack = await FirebaseFcn.firebaseGet("invoice_reference_stack");
    if (invoice_reference_stack != null) {
      // functions.logger.info("invoice_reference_stack: ", invoice_reference_stack);
      invoice_reference_stack_keys = Object.keys(invoice_reference_stack);
    }
  } catch (error) {
    functions.logger.error("[odooToFirebase_CRMTickets] ERROR 2410231410: " + error, {"odoo_session": odoo_session} );
  }

  try {
    const response = await fetch(settings.odoo_url + "dataset/search_read", params);
    const data = await response.json();

    // functions.logger.info( "[odooToFirebase_CRMTickets] tickets:", {
    //   "odoo_session": odoo_session,
    //   "params": String(params) ,
    // });
    // console.log(raw);

    const qtty_entries = data.result.length;

    let update = false;
    // let letter = ""
    // Only works if there is at least a new ticket
    if (qtty_entries > 0) {
      functions.logger.info("[odooToFirebase_CRMTickets] Se ejecutó el siguiente query.", {"odoo_session": odoo_session, "raw": raw});

      const len = max_qtty_entries_per_session > qtty_entries ? qtty_entries : max_qtty_entries_per_session;

      let entries = data.result.records;

      let tickets = entries.sort((e:any, f:any) => Date.parse(e.write_date) - Date.parse(f.write_date));
      tickets = tickets.slice(0, len);

      functions.logger.info( "[odooToFirebase_CRMTickets] Entries Founded : target_data (sorted)", {
        "target_data (sorted)": tickets,
      });

      // Read from firebase, useful info
      const CRM_tickets_not_archived = await FirebaseFcn.firebaseGet("/CRM_tickets_not_archived");
      const keys_crm = Object.keys(CRM_tickets_not_archived);

      const notRegisteredUsers = await FirebaseFcn.firebaseGet("/notRegisteredUsers");
      const keys_potentials = Object.keys(notRegisteredUsers);

      const Data_client = await FirebaseFcn.firebaseGet("/Data_client");
      const keys_clients = Object.keys(Data_client);

      const ticketIdToPartnerId = new Map<string, string>();
      for (let i = 0; i < keys_crm.length; i++) {
        const key = String(keys_crm[i]);
        const val = String(CRM_tickets_not_archived[key]);
        ticketIdToPartnerId.set(val, key);
      }

      // for every ticket to write in firebase
      for (let i = 0; i < len; i++) {
        const ticket = tickets[i];
        const ticket_id = String(ticket["id"]);
        try {
          odoo_query_time = Date.parse(ticket.write_date);
          console.log(ticket.write_date);
          let full_data : any;
          full_data= await verify_user_exist_create_modify(odoo_session, ticket);
          functions.logger.info("User full data crm: " + ticket_id, {"full_data": full_data});

          let is_in_reference_stack_keys = invoice_reference_stack_keys?.includes(String(ticket.partner_id[0]));
          // let is_any_order_line = await is_there_order_line(odoo_session, ticket.partner_id[0]);

          // Saving info to write in firebase--------------------------------------------------------------------------------------------
          const stage_id = Number(ticket["stage_id"][0]);


          let ticket_status = "NaN";
          switch (stage_id) {
            case 1:
              ticket_status = "Cliente Potencial";
              break;
            case 2:
              ticket_status = "Cliente con firma";
              break;
            case 3:
              ticket_status = "Cliente con Venta perdida";
              break;
            case 4:
              if (full_data.user_data.category_id.includes(358)) ticket_status = "Cliente por instalar";
              else ticket_status = "Cliente ganado";
              break;
            default:
              break;
          }

          console.log("ticket_status: " + ticket_status);

          if (ticket_status == "Cliente ganado") {
            // busca si ya esta creada la orden en la lista stack. sino la crea y la agrega a la lista.

            console.log("is_in_reference_stack_keys", is_in_reference_stack_keys);

            if (!is_in_reference_stack_keys) {
              /*
                if (!is_any_order_line) {
                   let sale_order_status= await create_sale_order_and_invoice(odoo_session, ticket.id, ticket.name, ticket.partner_id[0]);
                  if (sale_order_status == false) {
                    console.log("error 404. create_sale_order_and_invoice not working well");
                  } else {
                    console.log("create_sale_order_and_invoice ok");
                  }
                  console.log("create_sale_order_and_invoice is not working anymore.");

                } else {
                  // crea item en la lista
                  let invoice_reference_stack_map = new Map();

                  invoice_reference_stack_map.set(ticket.partner_id[0], ticket.name);

                  const invoice_reference_stack_json = Object.fromEntries(invoice_reference_stack_map);
                  FirebaseFcn.firebaseUpdate("invoice_reference_stack", invoice_reference_stack_json);
                }

                */

              let user_with_payment = await read_accountmove_reference(odoo_session, [ticket.partner_id[0]]);
              // console.log("user_with_payment ", user_with_payment);
              // console.log("user_with_payment.length", user_with_payment.length);
              if (user_with_payment.length>0) {
                let is_there = await is_there_install_serviceTicket(odoo_session, ticket.partner_id[0]);


                // check if has ticket already. if not, update invoice_reference_stack
                if (!is_there) {
                  let invoice_reference_stack_map = new Map();

                  invoice_reference_stack_map.set(ticket.partner_id[0], ticket.name);

                  const invoice_reference_stack_json = Object.fromEntries(invoice_reference_stack_map);
                  // console.log("user_with_payment 2 ", invoice_reference_stack_json);

                  FirebaseFcn.firebaseUpdate("invoice_reference_stack", invoice_reference_stack_json);

                  functions.logger.info("Se ha añadido el registro a invoices references stack:  ", invoice_reference_stack_json);
                }
              } else {
                let invoice_reference_stack_map = new Map();

                invoice_reference_stack_map.set(ticket.partner_id[0], ticket.name);

                const invoice_reference_stack_json = Object.fromEntries(invoice_reference_stack_map);
                FirebaseFcn.firebaseUpdate("invoice_reference_stack", invoice_reference_stack_json);

                functions.logger.info("Se ha añadido el registro a invoices references stack:  ", invoice_reference_stack_json);
              }
            }
          } else {
            console.log("--1");
            if (is_in_reference_stack_keys) {
              console.log("--2");

              FirebaseFcn.firebaseRemove("invoice_reference_stack/" + String(ticket.partner_id[0]));
            }
          }

          let partner_id = "NaN";
          if (stage_id != 0) {
            if (ticket["partner_id"] != false) partner_id = String(ticket["partner_id"][0]);
          }

          let campaign_id = "NaN";
          if (ticket["campaign_id"][1] != undefined) campaign_id = ticket["campaign_id"][1];

          let medium_id = "NaN";
          if (ticket["medium_id"][1] != undefined) medium_id = ticket["medium_id"][1];

          let source_id = "NaN";
          if (ticket["source_id"][1] != undefined) source_id = ticket["source_id"][1];

          let referred = ticket["referred"];
          if (referred === false) referred = "NaN";

          const name = ticket["name"];

          let phone = ticket["phone"];
          if (phone === false) phone = "NaN";

          let mobile = ticket["mobile"];
          if (mobile === false) mobile = "NaN";


          const tag_ids = ticket["tag_ids"];
          // tag_ids defines ticket type acording the relation below
          let ticket_type = "Otro";
          if (tag_ids.includes(2)) ticket_type = "Ventas-Pamplona";
          if (tag_ids.includes(3)) ticket_type = "Ventas-Accu";


          let sales_person_name;
            full_data.crm_data.user_id? sales_person_name = full_data.crm_data.user_id[1]:false;

            console.log("sales_person_name 2", sales_person_name);

            const create_date = Date.parse(ticket["create_date"]);

            // Writing in firebase with the info saved--------------------------------------------------------------------------------------


            const ToDoList = [];

            // Write in firebase depending on case++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
            if (keys_potentials.includes(ticket_id)) {
              // ****************************************************************************************
              sales_person_name = notRegisteredUsers[ticket_id]["Sales_person"];
              console.log("sales_person_name 1", sales_person_name);
              // const potentialAddress = "/notRegisteredUsers/" + ticket_id;
              // const initialState = await FirebaseFcn.firebaseGet(potentialAddress);
              const initialState = notRegisteredUsers[ticket_id];
              const targetState = initialState;

              if (ticket_status === "Cliente Potencial") {
                ToDoList.push("Update notRegisteredUsers data");
                targetState["Campaign_month"] = campaign_id;
                targetState["How_know_us"] = medium_id;
                targetState["How_know_us_method"] = source_id;
                targetState["How_know_us_referals"] = referred;
                targetState["Name_potencial"] = name;
                targetState["Phone1"] = phone;
                targetState["Phone2"] = mobile;
                targetState["Sales_person"] = sales_person_name;
                targetState["Zone"] = ticket_type;

                functions.logger.info( "[odooToFirebase_CRMTickets] (1) Tasks. ", {
                  "odoo_session": odoo_session,
                  "crm_id": ticket_id,
                  "to-do-list": ToDoList,
                  "initialState": initialState,
                  "targetState": targetState,
                });

                await FirebaseFcn.firebaseSet("/notRegisteredUsers/" + ticket_id, targetState);
                functions.logger.info( "[odooToFirebase_CRMTickets] Ticket updated in Firebase (/notRegisteredUsers/"+ ticket_id +").", {
                  "odoo_session": odoo_session,
                  "targetState": targetState,
                });
                update = true;
              } else {
              // ****************************************************************************************
                if (partner_id === "NaN") {
                  // ----------------------------------------------------------------------------------
                  ToDoList.push("Update notRegisteredUsers data");
                  targetState["Campaign_month"] = campaign_id;
                  targetState["How_know_us"] = medium_id;
                  targetState["How_know_us_method"] = source_id;
                  targetState["How_know_us_referals"] = referred;
                  targetState["Name_potencial"] = name;
                  targetState["Phone1"] = phone;
                  targetState["Phone2"] = mobile;
                  targetState["Sales_person"] = sales_person_name;
                  targetState["Zone"] = ticket_type;
                  functions.logger.info( "[odooToFirebase_CRMTickets] (2) Tasks. ", {
                    "odoo_session": odoo_session,
                    "crm_id": ticket_id,
                    "to-do-list": ToDoList,
                    "initialState": initialState,
                    "targetState": targetState,
                  });

                  await FirebaseFcn.firebaseSet("/notRegisteredUsers/" + ticket_id, targetState);
                  functions.logger.info( "[odooToFirebase_CRMTickets] Ticket updated in Firebase (/notRegisteredUsers/"+ ticket_id +").", {
                    "targetState": targetState,
                    "odoo_session": odoo_session,
                  });
                  update = true;
                } else {
                  // --------------------------------------------------------------------------------------------
                  if (keys_clients.includes(partner_id)) {
                    // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
                    ToDoList.push("Delete notRegisteredUsers node in firebase");
                    ToDoList.push("Update client type in firebase");

                    const contact_type2 = await FirebaseFcn.firebaseGet("/Data_client/"+partner_id+"/Data_client_2/Client_Type");
                    const contact_type3 = await FirebaseFcn.firebaseGet("/Data_client/"+partner_id+"/Data_client_3/client_type");

                    const init = {
                      "Client_Type": contact_type2,
                      "client_type": contact_type3,
                    };

                    const targ = {
                      "Client_Type": ticket_status,
                      "client_type": ticket_status,
                    };

                    functions.logger.info( "[odooToFirebase_CRMTickets] (3) Tasks. ", {
                      "odoo_session": odoo_session,
                      "crm_id": ticket_id,
                      "user_id": partner_id,
                      "to-do-list": ToDoList,
                      "initialState": init,
                      "targetState": targ,
                    });

                    await FirebaseFcn.firebaseRemove("/notRegisteredUsers/" + ticket_id);
                    functions.logger.info("[odooToFirebase_CRMTickets] notRegisteredUsers deleted from firebase (/notRegisteredUsers/"+ ticket_id +").", {
                      "odoo_session": odoo_session,
                    });

                    await FirebaseFcn.firebaseSet("/Data_client/"+partner_id+"/Data_client_2/Client_Type", ticket_status);
                    functions.logger.info("[odooToFirebase_CRMTickets] client type updated in Firebase (/Data_client/"+partner_id+"/Data_client_2/Client_Type).", {
                      "odoo_session": odoo_session,
                      "ticket_status": ticket_status,
                    });
                    await FirebaseFcn.firebaseSet("/Data_client/"+partner_id+"/Data_client_3/client_type", ticket_status);
                    functions.logger.info("[odooToFirebase_CRMTickets] client type updated in Firebase (/Data_client/"+partner_id+"/Data_client_3/client_type).", {
                      "odoo_session": odoo_session,
                      "ticket_status": ticket_status,
                    });

                    update = true;
                  } else {
                    // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
                    const contactData = await contactInfoById(odoo_session, partner_id);
                    if ((contactData != null) && (contactData != false)) {
                      ToDoList.push("Delete notRegisteredUsers node in firebase");
                      ToDoList.push("Create CRM_tickets_not_archived node in firebase");
                      ToDoList.push("Create Data_client node in firebase");

                      let phone1 = "NaN";
                      if (contactData["phone"] != false) phone1 = contactData["phone"];

                      let phone2 = "NaN";
                      if (contactData["phone"] != false) phone2 = contactData["phone"];

                      let country = "NaN";
                      if (contactData["country_id"] != false) country = contactData["country_id"][1];

                      let ubigeo = "NaN";
                      if (contactData["l10n_pe_ubigeo"] != false) ubigeo = contactData["zip"];

                      let address = "";

                      if (contactData.street != false) address = contactData.street;
                      if (contactData.street2 != false) address = address + ", " + contactData.street2;
                      if (contactData.city != false) address = address + ", " + contactData.city;
                      if (contactData.country_id != false) address = address + ", " + contactData.country_id[1];

                      if (address=="") address = "NaN";

                      // address = "NaN";
                      // if (contactData["contact_address"] != false) address = contactData["contact_address"];

                      let name_1 = "NaN";
                      if (contactData["name"] != false) name_1 = contactData["name"];

                      // let name_2 = "NaN";
                      // if (contactData["middle_name"] != false) name_2 = contactData["middle_name"];

                      let dni = "NaN";
                      if (contactData["vat"] != false) dni = contactData["vat"];

                      // let last_name_1 = "NaN";
                      // if (contactData["surname"] != false) last_name_1 = contactData["surname"];

                      // let last_name_2 = "NaN";
                      // if (contactData["mother_name"] != false) last_name_2 = contactData["mother_name"];

                      const Data_client_1 = {
                        "Addr_reference": "NaN",
                        "Address": address,
                        "Birth_date": "000000",
                        "Campaign_month": campaign_id,
                        "Client_Community": "NaN",
                        "Country": country,
                        "DNI": dni,
                        "How_know_us": medium_id,
                        "How_know_us_method": source_id,
                        "How_know_us_referals": referred,
                        "Lost_client_reason": "NaN",
                        "Name_1": name_1,
                        "Name_potencial": name,
                        "Phone1": phone1,
                        "Phone2": phone2,
                        "Sales_person": sales_person_name,
                        "Sales_person_Commit": "NaN",
                        "Urine_preference": "NaN",
                        "Zone": ticket_type,
                        "ubigeo": ubigeo,
                      };
                      const Data_client_2 = {
                        "Route": "NaN",
                        "Stops": "NaN",
                        "Client_Type": ticket_status,
                        "Lat": 0,
                        "Long": 0,
                      };
                      const Data_client_3 = {
                        "Name_complete": contactData["display_name"],
                        "Addr": address,
                        "Addr_reference": "NaN",
                        "client_coment_OPE": "NaN",
                        "client_coment_OPE2": "NaN",
                        "client_coment_OPE3": "NaN",
                        "Phone1": phone1,
                        "Phone2": phone2,
                        "client_type": ticket_status,
                      };

                      const targ = {
                        "CRM_tickets_not_archived": {partner_id: ticket_id},
                        "Data_client_1": Data_client_1,
                        "Data_client_2": Data_client_2,
                        "Data_client_3": Data_client_3,
                      };


                      functions.logger.info( "[odooToFirebase_CRMTickets] (4) Tasks. ", {
                        "odoo_session": odoo_session,
                        "crm_id": ticket_id,
                        "to-do-list": ToDoList,
                        "initialState": [],
                        "targetState": targ,
                      });

                      await FirebaseFcn.firebaseRemove("/notRegisteredUsers/" + ticket_id);
                      functions.logger.info("[odooToFirebase_CRMTickets] notRegisteredUsers deleted from firebase (/notRegisteredUsers/"+ ticket_id +").", {
                        "odoo_session": odoo_session,
                      });

                      await FirebaseFcn.firebaseSet("/CRM_tickets_not_archived/" + partner_id, ticket_id);
                      functions.logger.info("[odooToFirebase_CRMTickets] CRM_tickets_not_archived created in firebase (CRM_tickets_not_archived/" + partner_id +").", {
                        "odoo_session": odoo_session,
                        "targetState": ticket_id,
                      });

                      const clientData = {
                        "Data_client_1": Data_client_1,
                        "Data_client_2": Data_client_2,
                        "Data_client_3": Data_client_3,
                      };

                      await FirebaseFcn.firebaseSet("/Data_client/" + partner_id, clientData);
                      functions.logger.info( "[odooToFirebase_CRMTickets] Data_client created in firebase (/Data_client/" + partner_id + ").", {
                        "crm_id": ticket_id,
                        "user_id": partner_id,
                        "clientData": clientData,
                      });
                      update = true;
                    } else {
                      if (contactData === null) {
                        functions.logger.error("[odooToFirebase_CRMTickets] ERROR. No se cargó la información de contacto", {
                          "odoo_session": odoo_session,
                          "ticket_id": ticket_id,
                          "partner_id": partner_id,
                        } );
                        // Error al cargar la información del contacto
                        // se envia al nodo de lecturas pendientes + true
                        // Se carga la info en letter
                      }

                      if (contactData === false) {
                        functions.logger.error("[odooToFirebase_CRMTickets] ERROR. No se encontró la información de contacto", {
                          "odoo_session": odoo_session,
                          "ticket_id": ticket_id,
                          "partner_id": partner_id,
                        } );
                        // Error: no se encontró información del contacto, la lectura se hizo pero no se encontró ningun contacto con el id
                        // Se enbia al nodo de lecturas pendientes + false
                        // Se carga la info en letter
                      }

                      functions.logger.info( "[odooToFirebase_CRMTickets] No updates done.", {
                        "ticket_id": ticket_id,
                        "partner_id": partner_id,
                      });
                    }
                  }
                }
              }
            } else {
              // **********************************************************************************************
              if (Object.keys(ticketIdToPartnerId).includes(ticket_id)) {
                // ------------------------------------------------------------------------------------------
                ToDoList.push("Update client type in firebase");

                const contact_type2 = await FirebaseFcn.firebaseGet("/Data_client/"+partner_id+"/Data_client_2/Client_Type");
                const contact_type3 = await FirebaseFcn.firebaseGet("/Data_client/"+partner_id+"/Data_client_3/client_type");

                const init = {
                  "Client_Type": contact_type2,
                  "client_type": contact_type3,
                };

                const targ = {
                  "Client_Type": ticket_status,
                  "client_type": ticket_status,
                };

                functions.logger.info( "[odooToFirebase_CRMTickets] (5) Tasks. ", {
                  "odoo_session": odoo_session,
                  "crm_id": ticket_id,
                  "user_id": partner_id,
                  "to-do-list": ToDoList,
                  "initialState": init,
                  "targetState": targ,
                });

                const id_client = ticketIdToPartnerId.get(ticket_id);
                await FirebaseFcn.firebaseSet("/Data_client/"+id_client+"/Data_client_2/Client_Type", ticket_status);
                functions.logger.info("[odooToFirebase_CRMTickets] client type updated in Firebase (/Data_client/"+id_client+"/Data_client_2/Client_Type).", {
                  "odoo_session": odoo_session,
                  "ticket_status": ticket_status,
                });
                await FirebaseFcn.firebaseSet("/Data_client/"+id_client+"/Data_client_3/client_type", ticket_status);
                functions.logger.info("[odooToFirebase_CRMTickets] client type updated in Firebase (/Data_client/"+id_client+"/Data_client_3/client_type).", {
                  "odoo_session": odoo_session,
                  "ticket_status": ticket_status,
                });

                update = true;
              } else {
                // ------------------------------------------------------------------------------------------
                if (partner_id === "NaN") {
                  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
                  ToDoList.push("Create notRegisteredUsers node in Firebase");

                  const targetState = {
                    "Campaign_month": campaign_id,
                    "How_know_us": medium_id,
                    "How_know_us_method": source_id,
                    "How_know_us_referals": referred,
                    "Name_potencial": name,
                    "Phone1": phone,
                    "Phone2": mobile,
                    "Sales_person": sales_person_name,
                    "Zone": ticket_type,
                    "timeStampCreate": String(create_date), // line 1510
                    "Sales_person_Commit": "NaN",
                    "Lat": 0,
                    "Long": 0,
                    "Client_Type": ticket_status,
                    "Client_Community": "NaN",
                  };

                  functions.logger.info( "[odooToFirebase_CRMTickets] (6) Tasks. ", {
                    "odoo_session": odoo_session,
                    "crm_id": ticket_id,
                    "to-do-list": ToDoList,
                    "initialState": [],
                    "targetState": targetState,
                  });

                  await FirebaseFcn.firebaseSet("/notRegisteredUsers/" + ticket_id, targetState);
                  functions.logger.info( "[odooToFirebase_CRMTickets] Ticket updated in Firebase (/notRegisteredUsers/"+ ticket_id +").", {
                    "targetState": targetState,
                    "odoo_session": odoo_session,
                  });

                  update = true;
                } else {
                  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
                  // await FirebaseFcn.firebaseSet("/CRM_tickets_not_archived/" + partner_id, id);
                  if (keys_clients.includes(partner_id)) {
                    // -------------------------------------------------------------------------------------------------
                    ToDoList.push("Update client type in firebase");

                    const contact_type2 = await FirebaseFcn.firebaseGet("/Data_client/"+partner_id+"/Data_client_2/Client_Type");
                    const contact_type3 = await FirebaseFcn.firebaseGet("/Data_client/"+partner_id+"/Data_client_3/client_type");

                    const init = {
                      "Client_Type": contact_type2,
                      "client_type": contact_type3,
                    };

                    const targ = {
                      "Client_Type": ticket_status,
                      "client_type": ticket_status,
                    };

                    functions.logger.info( "[odooToFirebase_CRMTickets] (7) Tasks. ", {
                      "odoo_session": odoo_session,
                      "crm_id": ticket_id,
                      "user_id": partner_id,
                      "to-do-list": ToDoList,
                      "initialState": init,
                      "targetState": targ,
                      "full_data": full_data,
                    });

                    await FirebaseFcn.firebaseSet("/Data_client/"+partner_id+"/Data_client_2/Client_Type", ticket_status);
                    functions.logger.info("[odooToFirebase_CRMTickets] client type updated in Firebase (/Data_client/"+partner_id+"/Data_client_2/Client_Type).", {
                      "odoo_session": odoo_session,
                      "ticket_status": ticket_status,
                    });
                    await FirebaseFcn.firebaseSet("/Data_client/"+partner_id+"/Data_client_3/client_type", ticket_status);
                    functions.logger.info("[odooToFirebase_CRMTickets] client type updated in Firebase (/Data_client/"+partner_id+"/Data_client_3/client_type).", {
                      "odoo_session": odoo_session,
                      "ticket_status": ticket_status,
                    });

                    update = true;
                  } else {
                    // ------------------------------------------------------------------------------------------------
                    const contactData = await contactInfoById(odoo_session, partner_id);
                    if ((contactData != null) && (contactData != false)) {
                      ToDoList.push("Create CRM_tickets_not_archived node in firebase");
                      ToDoList.push("Create Data_client node in firebase");

                      let phone1 = "NaN";
                      if (contactData["phone"] != false) phone1 = contactData["phone"];

                      let phone2 = "NaN";
                      if (contactData["phone"] != false) phone2 = contactData["phone"];

                      let country = "NaN";
                      if (contactData["country_id"] != false) country = contactData["country_id"][1];

                      let ubigeo = "NaN";
                      if (contactData["zip"] != false) ubigeo = contactData["zip"];

                      let address = "";

                      if (contactData.street != false) address = contactData.street;
                      if (contactData.street2 != false) address = address + ", " + contactData.street2;
                      if (contactData.city != false) address = address + ", " + contactData.city;
                      if (contactData.country_id != false) address = address + ", " + contactData.country_id[1];

                      if (address=="") address = "NaN";

                      let name_1 = "NaN";
                      if (contactData["name"] != false) name_1 = contactData["name"];


                      let dni = "NaN";
                      if (contactData["vat"] != false) dni = contactData["vat"];


                      const Data_client_1 = {
                        "Addr_reference": "NaN",
                        "Address": address,
                        "Birth_date": "000000",
                        "Campaign_month": campaign_id,
                        "Client_Community": "NaN",
                        "Country": country,
                        "DNI": dni,
                        "How_know_us": medium_id,
                        "How_know_us_method": source_id,
                        "How_know_us_referals": referred,
                        "Lost_client_reason": "NaN",
                        "Name_1": name_1,
                        "Name_potencial": name,
                        "Phone1": phone1,
                        "Phone2": phone2,
                        "Sales_person": sales_person_name,
                        "Sales_person_Commit": "NaN",
                        "Urine_preference": "NaN",
                        "Zone": ticket_type,
                        "ubigeo": ubigeo,
                      };
                      const Data_client_2 = {
                        "Route": "NaN",
                        "Stops": "NaN",
                        "Client_Type": ticket_status,
                        "Lat": 0,
                        "Long": 0,
                      };
                      const Data_client_3 = {
                        "Name_complete": contactData["display_name"],
                        "Addr": address,
                        "Addr_reference": "NaN",
                        "client_coment_OPE": "NaN",
                        "client_coment_OPE2": "NaN",
                        "client_coment_OPE3": "NaN",
                        "Phone1": phone1,
                        "Phone2": phone2,
                        "client_type": ticket_status,
                      };

                      const targ = {
                        "CRM_tickets_not_archived": {partner_id: ticket_id},
                        "Data_client_1": Data_client_1,
                        "Data_client_2": Data_client_2,
                        "Data_client_3": Data_client_3,
                      };

                      functions.logger.info( "[odooToFirebase_CRMTickets] (8) Tasks. ", {
                        "odoo_session": odoo_session,
                        "crm_id": ticket_id,
                        "to-do-list": ToDoList,
                        "initialState": [],
                        "targetState": targ,
                      });

                      await FirebaseFcn.firebaseSet("/CRM_tickets_not_archived/" + partner_id, ticket_id);
                      functions.logger.info("[odooToFirebase_CRMTickets] CRM_tickets_not_archived created in firebase (CRM_tickets_not_archived/" + partner_id +").", {
                        "odoo_session": odoo_session,
                        "targetState": ticket_id,
                      });

                      const clientData = {
                        "Data_client_1": Data_client_1,
                        "Data_client_2": Data_client_2,
                        "Data_client_3": Data_client_3,
                      };

                      await FirebaseFcn.firebaseSet("/Data_client/" + partner_id, clientData);
                      functions.logger.info( "[odooToFirebase_CRMTickets] Data_client created in firebase (/Data_client/" + partner_id + ").", {
                        "crm_id": ticket_id,
                        "user_id": partner_id,
                        "targetState": clientData,
                      });
                      update = true;
                    } else {
                      if (contactData === null) {
                        functions.logger.error("[odooToFirebase_CRMTickets] ERROR. No se cargó la información de contacto", {
                          "odoo_session": odoo_session,
                          "ticket_id": ticket_id,
                          "partner_id": partner_id,
                        } );
                        // Error al cargar la información del contacto
                        // se envia al nodo de lecturas pendientes + true
                        // Se carga la info en letter
                      }

                      if (contactData === false) {
                        functions.logger.error("[odooToFirebase_CRMTickets] ERROR. No se encontró la información de contacto", {
                          "odoo_session": odoo_session,
                          "ticket_id": ticket_id,
                          "partner_id": partner_id,
                        } );
                        // Error: no se encontró información del contacto, la lectura se hizo pero no se encontró ningun contacto con el id
                        // Se enbia al nodo de lecturas pendientes + false
                        // Se carga la info en letter
                      }

                      functions.logger.info( "[odooToFirebase_CRMTickets] No updates done.", {
                        "ticket_id": ticket_id,
                        "partner_id": partner_id,
                      });
                    }
                  }
                }
              }
            }
        } catch (error) {
          functions.logger.error("[odooToFirebase_CRMTickets] ERROR: " + error, {
            "odoo_session": odoo_session,
            "ticket_id": ticket_id,
            "odoo_query_time": odoo_query_time,
            // "ticket_write_date": ticket[i].write_date,


          } );
        }
      }
      if (len<max_qtty_entries_per_session ) odoo_query_time = Date.now();
    } // else functions.logger.info("[odooToFirebase_CRMTickets] No CRM tickets founded in Odoo.", {"odoo_session": odoo_session});

    if (update) {
      FirebaseFcn.firebaseSet("/timestamp_collection/CMR_tickets_timestamp", String(odoo_query_time));
      functions.logger.info( "[odooToFirebase_CRMTickets]  updating CMR_tickets_timestamp in Firebase", {
        "odoo_session": odoo_session,
        "CMR_tickets_timestamp": String(odoo_query_time),
      });
    }

    // if (letter != "") Se envia el correo con la info en letter
  } catch (err) {
    functions.logger.error("[odooToFirebase_CRMTickets] ERROR 2310230044: " + err, {"odoo_session": odoo_session} );
    return false;
  }

  return true;
}

export async function firebaseToOdoo_ChangeStopsRoutesLabels(odoo_session:any, idOdoo: number, stopsOrRoutes_json:any) {
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  // from OdooGenerateJsonsToWriteOdoo function
  const raw = JSON.stringify({
    "params": {
      "model": "res.partner.category",
      "method": "write",
      "kwargs": {},
      "args": [idOdoo,
        {
          "partner_ids": stopsOrRoutes_json,
        }],
    },
  });

  const params = {
    headers: CustomHeaders,
    method: "post",
    body: raw,
  };

  await fetch(settings.odoo_url + "dataset/call_kw/res.partner.category/write", params);

  return null;
}

export async function getCategories(odoo_session:any) {
  let list;

  try {
    const CustomHeaders: HeadersInit = {
      "Content-Type": "application/json",
      "Cookie": "session_id="+odoo_session,
    };

    const raw = JSON.stringify({
      "params": {
        "model": "res.partner.category",
        "fields": ["id", "name"],
        "offset": 0,
        "domain": [],
      },
    });

    let params = {
      headers: CustomHeaders,
      method: "post",
      body: raw,
    };

    let response = await fetch(settings.odoo_url + "dataset/search_read/", params);

    let data = await response.json();
    list = data.result.records;
    // let stops_list: Array<number> = list.filter((e:any) => e.name.includes("Paradero:"))
    // let routes_list: Array<number> = list.filter((e:any) => e.name.includes("Ruta:"))
    // let states_list: Array<number> = list.filter((e:any) => e.name.includes("usuario activo") || e.name.includes("usuario inactivo") || e.name.includes("Usuario por instalar")  )
    return list;
  } catch (error) {
    return [];
  }
}

export async function firebaseToOdoo_DeleteStopLabels(odoo_session:any, idOdoo: number, partnerId: number) {
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  const raw_read = JSON.stringify({
    "params": {
      "model": "res.partner",
      "fields": [],
      "offset": 0,
      "domain": [["id", "like", partnerId]],
    },
  });

  const params_read = {
    headers: CustomHeaders,
    method: "post",
    body: raw_read,
  };

  const response_read = await fetch(settings.odoo_url + "dataset/search_read", params_read);
  const data_read = await response_read.json();
  const category_ids: Array<number> = data_read["result"]["records"][0]["category_id"];
  // console.log("category_ids", category_ids);

  const new_category_ids: Array<number> = category_ids.filter((id) => (id != idOdoo));
  // console.log("new_category_ids", new_category_ids);

  const raw_write = JSON.stringify({
    "params": {
      "model": "res.partner",
      "method": "write",
      "kwargs": {},
      "args": [
        partnerId,
        {
          "category_id": new_category_ids,
        },
      ],
    },
  });

  const params_write = {
    headers: CustomHeaders,
    method: "post",
    body: raw_write,
  };

  const response_write = await fetch(settings.odoo_url + "dataset/call_kw/res.partner/", params_write);
  const data_write = await response_write.json();
  // console.log("data_write", data_write);

  return data_write;
}

export async function firebaseToOdoo_CreateStopsRoutesLabels(odoo_session:any, name_stop: string, stops_json:any) {
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  // from OdooGenerateJsonsToWriteOdoo function
  const raw = JSON.stringify({
    "params": {
      "model": "res.partner.category",
      "method": "create",
      "kwargs": {},
      "args": [{
        "name": name_stop,
        "active": true,
        "partner_ids": stops_json,
      }],
    },
  });

  const params = {
    headers: CustomHeaders,
    method: "post",
    body: raw,
  };


  const response = await fetch(settings.odoo_url + "dataset/call_kw/res.partner.category/create", params);
  const data = await response.json();
  const idOdoo = String(data["result"]);
  // console.log("dataaa", data);

  return idOdoo;
}

export async function search_categories_Odoo(user_categories: any, categories_list: any) {
  let filtered_element;
  let filtered_list = [];
  for (let each_id= 0; each_id < user_categories.length; each_id++) {
    try {
      filtered_element = categories_list.filter((e:any) => e.id == Number(user_categories[each_id]));
      // console.log("filtered_element", filtered_element);
      filtered_list.push(filtered_element[0]);
    } catch (error) {
      functions.logger.error("[search_categories_Odoo] error 0211231159 ", error);
    }
  }
  return filtered_list;
}


export async function verifyIfodooWriteInFirebase(odoo_session:any, idOdoo: number, lastupdateTimestamp: any) {
  const date = new Date(Number(lastupdateTimestamp)-15000);
  const date_str = "'"+ date.getFullYear()+"-"+("0" + (date.getMonth() + 1)).slice(-2)+"-"+("0" +date.getDate()).slice(-2)+" "+ ("0" +date.getHours()).slice(-2)+":"+("0" +date.getMinutes()).slice(-2)+":"+("0" +date.getSeconds()).slice(-2) + "'";

  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  const raw = JSON.stringify({
    "params": {
      "model": "res.partner.category",
      "fields": ["id", "name"],
      "offset": 0,
      "domain": ["&", ["id", "=", idOdoo], ["write_date", ">", date_str]],
    },
  });

  const params = {
    headers: CustomHeaders,
    method: "post",
    body: raw,
  };

  const response = await fetch(settings.odoo_url + "dataset/search_read/", params);
  const data = await response.json();

  const len: number = data["result"]["length"];

  return (len > 0);
}

async function contactInfoById(odoo_session:any, id_client: any) {
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  const raw = JSON.stringify({
    "params": {
      "model": "res.partner",
      "fields": ["id", "phone", "mobile", "comment", "name", "vat", "street", "street2", "city",
        "country_id", "display_name", "category_id", "zip"],
      "offset": 0,
      "domain": [["id", "=", id_client]],
    },
  });

  const params = {
    headers: CustomHeaders,
    method: "call",
    body: raw,
  };
  try {
    const response = await fetch(settings.odoo_url + "dataset/search_read", params);
    const data = await response.json();
    const len = data["result"]["length"];

    if (len > 0) {
      functions.logger.info("[contactInfoById] Contact info charged succesfully", {"odoo_session": odoo_session} );
      return data["result"]["records"][0];
    } else {
      functions.logger.info("[contactInfoById] No contac founded", {"odoo_session": odoo_session} );
      return false;
    }
  } catch (err) {
    functions.logger.error("[contactInfoById] ERROR: " + err, {"odoo_session": odoo_session} );
    return null;
  }
}

export async function firebaseToOdoo_PutInactiveTag(odoo_session: any, idOdoo: number) {
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  const raw = JSON.stringify({
    "params": {
      "model": "res.partner",
      "method": "write",
      "kwargs": {},
      "args": [
        idOdoo,
        {
          "category_id": [359],
        },
      ],
    },
  });

  const params = {
    headers: CustomHeaders,
    method: "post",
    body: raw,
  };

  const response_write = await fetch(settings.odoo_url + "dataset/call_kw/res.partner/", params);
  const data_write = await response_write.json();
  // console.log("data_write", data_write);

  return data_write;
}

export async function firebaseToOdoo_ActiveOrInstall(odoo_session:any, partnerId: number) {
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  const raw_read = JSON.stringify({
    "params": {
      "model": "res.partner",
      "fields": [],
      "offset": 0,
      "domain": [["id", "like", partnerId]],
    },
  });

  const params_read = {
    headers: CustomHeaders,
    method: "post",
    body: raw_read,
  };

  const response_read = await fetch(settings.odoo_url + "dataset/search_read", params_read);
  const data_read = await response_read.json();
  const category_ids: Array<number> = data_read["result"]["records"][0]["category_id"];
  // console.log("category_ids", category_ids);
  // let newTag = 358;
  // if (active === false) newTag = 453;
  let newTag = 453;

  const aux_category_ids: Array<number> = category_ids.filter((id) => ((id != 358) && (id != 359) && (id != 453)));
  // console.log("aux_category_ids", aux_category_ids);
  const new_category_ids: Array<number> = aux_category_ids.concat([newTag]);
  // console.log("new_category_ids", new_category_ids);

  const raw_write = JSON.stringify({
    "params": {
      "model": "res.partner",
      "method": "write",
      "kwargs": {},
      "args": [
        partnerId,
        {
          "category_id": new_category_ids,
        },
      ],
    },
  });

  const params_write = {
    headers: CustomHeaders,
    method: "post",
    body: raw_write,
  };

  const response_write = await fetch(settings.odoo_url + "dataset/call_kw/res.partner/", params_write);
  const data_write = await response_write.json();
  // console.log("data_write", data_write);

  return data_write;
}

export async function firebaseToOdoo_updateTickets(odoo_session:any, idTicket: number, description: any) {
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  // from OdooGenerateJsonsToWriteOdoo function
  const raw = JSON.stringify({
    "params": {
      "model": "helpdesk.ticket",
      "method": "write",
      "kwargs": {},
      "args": [
        idTicket,
        {
          "stage_id": 2,
          "description": description,
        },
      ],
    },
  });

  const params = {
    headers: CustomHeaders,
    method: "post",
    body: raw,
  };


  const response = await fetch(settings.odoo_url + "dataset/call_kw/helpdesk.ticket/write", params);
  const data = await response.json();

  return data;
}

export async function firebaseToOdoo_approveTicket(odoo_session:any, idTicket: number, aprove: boolean) {
  let stage_id = 1;
  if (aprove === true) stage_id = 14;

  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  // from OdooGenerateJsonsToWriteOdoo function
  const raw = JSON.stringify({
    "params": {
      "model": "helpdesk.ticket",
      "method": "write",
      "kwargs": {},
      "args": [
        idTicket,
        {
          "stage_id": stage_id,
        },
      ],
    },
  });

  const params = {
    headers: CustomHeaders,
    method: "post",
    body: raw,
  };


  const response = await fetch(settings.odoo_url + "dataset/call_kw/helpdesk.ticket/write", params);
  const data = await response.json();

  return data;
}

export async function firebaseToOdoo_stock(odoo_session:any, partner_id: number, listOfInv: any, ticket_id: any) {
  /* const itemsCollection = {
    "Baño completo": 793,
    "Tubo de Vent. 3\"": 865,
    "Sombrerito 3\" con malla": 232,
    "Unión 3\"": 871,
    "Codo 45° 3\"": 194,
    "Codo 90° 3\"": 849,
    "Tubo 3/4\" (niple)": 889,
    "Codo 3/4\" 90°": 850,
    "Curva 3/4\"": 196,
    "Codo 45° 3/4\"": 192,
    "Unión 3/4\"": 253,
    "Manguera 1\"": 848,
    "Tapa 4\"": 238,
    "Tapa 3\"": 237,
    "Tubo 2\"": 247,
    "Reducción 3/4\"- 2\"": 221,
    "Unión 2”": 252,
    "T 3/4": 235,
    "Galonera": 257,
    "Bolsa con aserrín": 183,
    "Bolsa con aserrín_extra": 1010,
    "Bolsas extra": 182,
    "Blocker azul": 795,
    "Ganchos amarillos": 796,
    "Manual de uso y\nmantenimiento": 1034,
    "Ventilador": 255,
    "Tapa asiento": 239,
  } */

  const InventoryCollection = await getItemsCollection(odoo_session);

  if (InventoryCollection != false) {
    const CustomHeaders: HeadersInit = {
      "Content-Type": "application/json",
      "Cookie": "session_id="+odoo_session,
    };

    const raw_create = JSON.stringify({
      "params": {
        "model": "stock.picking",
        "method": "create",
        "kwargs": {},
        "args": [{
          "location_id": 18,
          "picking_type_id": 7,
          "partner_id": partner_id,
          "state": "draft",
          "location_dest_id": 5,
          "show_operations": true,
          "show_validate": true,
          "immediate_transfer": true,
        }],
      },
    });

    const params_create = {
      headers: CustomHeaders,
      method: "call",
      body: raw_create,
    };

    try {
      const response_create = await fetch(settings.odoo_url + "dataset/call_kw/stock.picking/create", params_create);
      const data_create = await response_create.json();
      const idOdoo = data_create["result"];

      const raw_update = JSON.stringify({
        "params": {
          "model": "stock.picking",
          "method": "write",
          "kwargs": {},
          "args": [
            Number(idOdoo),
            {
              "state": "done",
              "priority": "1",
              "show_validate": false,
            }],
        },
      });

      const params_update = {
        headers: CustomHeaders,
        method: "call",
        body: raw_update,
      };

      try {
        const response_update = await fetch(settings.odoo_url + "dataset/call_kw/stock.picking/write", params_update);
        const data_update = await response_update.json();

        if (data_update["result"] === true) {
          const keys = listOfInv.keys();
          for (let key of keys) { // for (let i = 0; i< keys.length ; i++) { const key = String(keys[i]);
            if (InventoryCollection.get(key)!= null && InventoryCollection.get(key)!= undefined) {
              const raw_item = JSON.stringify({
                "params": {
                  "model": "stock.move.line",
                  "method": "create",
                  "kwargs": {},
                  "args": [{
                    "picking_id": Number(idOdoo),
                    "move_id": false,
                    "company_id": 1,
                    "product_id": InventoryCollection.get(key),
                    "product_uom_id": 1,
                    "qty_done": listOfInv.get(key),
                    "location_id": 18,
                    "location_dest_id": 5,
                    "reference": false,
                    "is_locked": false,
                  }],
                },
              });

              const params_item = {
                headers: CustomHeaders,
                method: "call",
                body: raw_item,
              };
              try {
                await fetch(settings.odoo_url + "dataset/call_kw/stock.move.line/create", params_item);
              } catch (err2) {
                functions.logger.error("[firebaseToOdoo_stock] ERROR: " + err2, {
                  "odoo_session": odoo_session,
                  "ticket_id": ticket_id,
                  "product_id": InventoryCollection.get(key),
                });
              }
            }
          }
        }
      } catch (err1) {
        functions.logger.error("[firebaseToOdoo_stock] ERROR: " + err1, {"odoo_session": odoo_session, "ticket_id": ticket_id} );
      }
    } catch (err) {
      functions.logger.error("[firebaseToOdoo_stock] ERROR: " + err, {"odoo_session": odoo_session, "ticket_id": ticket_id} );
    }
  }

  return null;
}

export async function createTicketCRM(odoo_session: any, args: any) {
  // check odoo user after create it


  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  // from OdooGenerateJsonsToWriteOdoo function
  const raw = JSON.stringify({
    "params": {
      "model": "crm.lead",
      "method": "create",
      "kwargs": {},
      "args": [args],
    },
  });

  const params = {
    headers: CustomHeaders,
    method: "post",
    body: raw,
  };

  try {
    const response = await fetch(settings.odoo_url + "dataset/call_kw/crm.lead/create", params);
    const data = await response.json();
    const idOdoo = data["result"];

    const request_str = JSON.stringify(args);
    functions.logger.info("[createTicketCRM]: Ticket CRM created in odoo.", {
      "odoo_session": odoo_session,
      "user_id": idOdoo,
      "targetState": request_str,
    });

    return idOdoo;
  } catch (err) {
    functions.logger.error( "[createTicketCRM] ERROR: ", err);
    return null;
  }
}


export async function readTicketCRM(odoo_session:any, lastupdateTimestamp: any, args:any) {
  // The function reads the tickes CRM created in odoo after the last update

  lastupdateTimestamp = lastupdateTimestamp -60000;
  const date = new Date(Number(lastupdateTimestamp));
  const date_str = "'"+ date.getFullYear()+"-"+("0" + (date.getMonth() + 1)).slice(-2)+"-"+("0" +date.getDate()).slice(-2)+" "+ ("0" +date.getHours()).slice(-2)+":"+("0" +date.getMinutes()).slice(-2)+":"+("0" +date.getSeconds()).slice(-2) + "'";

  // console.log("ARGS ", args)
  // console.log(args.name)
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  const raw = JSON.stringify({
    "params": {
      "model": "crm.lead",
      "offset": 0,
      "fields": [
        "partner_id", "campaign_id", "stage_id", "medium_id", "source_id", "referred",
        "name", "phone", "mobile", "tag_ids", "user_id", "create_date", "write_date", "color",
      ],
      "domain": ["&", ["name", "=", args.name], ["write_date", ">", date_str], ["user_id", "=", args.user_id]],
    },
  });

  const params = {
    headers: CustomHeaders,
    method: "call",
    body: raw,
  };

  try {
    const response = await fetch(settings.odoo_url + "dataset/search_read", params);
    const data = await response.json();
    const len = data.result.length;

    if (len == 0 ) return false;
    else {
      const crm_id = data.result.id;
      const user_id = data.result.partner_id[0];
      const res = {
        "crm_id": crm_id,
        "user_id": user_id,
      };
      return res;
    }
  } catch (err) {
    functions.logger.error("[odooToFirebase_CRMTickets] ERROR 2310230045: " + err, {"odoo_session": odoo_session} );
    return 0
    ;
  }

  return 0;
}


export async function firebaseToOdoo_updateCRM(odoo_session:any, partner_id: number, idTicket: number, venta: boolean) {
  const args = [];
  let stage_id = 2;

  args.push(idTicket);

  if (venta === true) {
    args.push({
      "stage_id": 2,
      "partner_id": partner_id,
    });
  } else {
    args.push({
      "stage_id": 3,
    });
    stage_id = 3;
  }


  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  // from OdooGenerateJsonsToWriteOdoo function
  const raw = JSON.stringify({
    "params": {
      "model": "crm.lead",
      "method": "write",
      "kwargs": {},
      "args": args,
    },
  });

  const params = {
    headers: CustomHeaders,
    method: "post",
    body: raw,
  };


  const response = await fetch(settings.odoo_url + "dataset/call_kw/crm.lead/write", params);
  const data = await response.json();

  try {
    const res = data.result;
    functions.logger.info("[firebaseToOdoo_updateCRM] CRM succesfully updated in Odoo ("+partner_id+")", {
      "odoo_session": odoo_session,
      "id_user": partner_id,
      "id_ticket_crm": idTicket,
      "stage_id": stage_id,
    });
    return res;
  } catch (error) {
    functions.logger.error("[firebaseToOdoo_updateCRM] ERROR 0311231158 updated CRM in Odoo ("+partner_id+")", {
      "odoo_session": odoo_session,
      "id_user": partner_id,
      "id_ticket_crm": idTicket,
      "stage_id": stage_id,
    });
    return false;
  }
}

export async function createUser_Odoo_firebase(odoo_session: any, contact_data_json: any, id_ticket_crm: any) {
  // 1. Get id_odoo
  try {
    const CustomHeaders: HeadersInit = {
      "Content-Type": "application/json",
      "Cookie": "session_id="+odoo_session,
    };

    // from OdooGenerateJsonsToWriteOdoo function
    const raw = JSON.stringify({
      "params": contact_data_json.params,
    });

    const params = {
      headers: CustomHeaders,
      method: "post",
      body: raw,
    };

    const response = await fetch(settings.odoo_url + "dataset/call_kw/res.partner/create", params);
    const data = await response.json();

    functions.logger.info("[createUser_Odoo_firebase] User ("+ contact_data_json.params.args[0].name+") succesfully created in Odoo ("+ data.result+")", {
      "odoo_session": odoo_session,
      "id_user": data.result,
    });

    // 2. update crm
    await firebaseToOdoo_updateCRM(odoo_session, data.result, id_ticket_crm, true);

    const res = {
      "result": Number(data.result),
    };
    return res;
  } catch (error) {
    functions.logger.error("[createUser_Odoo_firebase] Error creating user in Odoo", {
      "odoo_session": odoo_session,
      "params": contact_data_json.params,
    });
    const res = {
      "result": false,
    };
    return res;
  }
}

export async function create_user_in_Odoo(odoo_session: any, crm_ticket: any) {
  // 1. Get id_odoo

  functions.logger.info("create_user_in_Odoo: ", crm_ticket);

  if (crm_ticket.partner_id == false) {
    const CustomHeaders: HeadersInit = {
      "Content-Type": "application/json",
      "Cookie": "session_id="+odoo_session,
    };

    // from OdooGenerateJsonsToWriteOdoo function
    const raw = JSON.stringify({
      "params": {
        "model": "res.partner",
        "method": "create",
        "kwargs": {},
        "args": [{
          "is_company": false,
          "phone": crm_ticket.phone,
          "mobile": crm_ticket.mobile,
          "name": crm_ticket.name,
          "vat": false,
          "l10n_latam_identification_type_id": 5,
          "street": crm_ticket.street,
          "street2": crm_ticket.street2,
          "country_id": crm_ticket.country_id[0],
          "zip": crm_ticket.zip,
          "category_id": [],
          "city": crm_ticket.city,
          "state_id": crm_ticket.state_id[0],
          "tz": "America/Lima",
          "tz_offset": "-0500",
          "user_id": 24,
          "city_id": 128,
          "opportunity_ids": [crm_ticket.id],

        }],
      },
    });

    const params = {
      headers: CustomHeaders,
      method: "post",
      body: raw,
    };

    const response = await fetch(settings.odoo_url + "dataset/call_kw/res.partner/create", params);
    const data = await response.json();

    try {
      functions.logger.info("[createUser_Odoo_firebase] User ("+ crm_ticket.name+") succesfully created in Odoo ("+ data.result+")", {
        "odoo_session": odoo_session,
        "id_user": data.result,
      });

      return data.result;
    } catch (error) {
      functions.logger.error("[createUser_Odoo_firebase] Error creating user in Odoo", {
        "odoo_session": odoo_session,
        "params": params.body,
      });

      return 0;
    }
  } else {
    functions.logger.info("No need to create user because it already exists");
    return crm_ticket.partner_id;
  }
}

export async function create_user_in_Odoo2(odoo_session: any, crm_ticket_id: any, _data: any) {
  // 1. Get id_odoo

  functions.logger.info("create_user_in_Odoo2: crm: ", crm_ticket_id);


  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };


  // from OdooGenerateJsonsToWriteOdoo function
  const raw = JSON.stringify({
    "params": {
      "model": "res.partner",
      "method": "create",
      "kwargs": {},
      "args": [{
        "is_company": false,
        "phone": _data.phone != undefined? _data.phone: false,
        "mobile": _data.mobile!= undefined? _data.mobile: false,
        "name": _data.name!= undefined? _data.name: false,
        "vat": _data.dni!= undefined? _data.dni: false,
        "l10n_latam_identification_type_id": 5,
        "street": _data.street!= undefined? _data.street: false,
        "street2": _data.street2!= undefined? _data.street2: false,
        "function": _data.function!= undefined? _data.function: false,
        // "country_id": _data.country_id[0]!= undefined? _data.country_id[0]: false,
        // "zip": _data.zip!= undefined? _data.zip: false,
        // "city": _data.city!= undefined? _data.city: false,
        // "state_id": _data.state_id[0]!= undefined? _data.state_id[0]: false,
        // "tz": "America/Lima",
        // "tz_offset": "-0500",
        // "user_id": 24,
        // "city_id": 128,
        "opportunity_ids": [Number(crm_ticket_id)],

      }],
    },
  });

  const params = {
    headers: CustomHeaders,
    method: "post",
    body: raw,
  };

  const response = await fetch(settings.odoo_url + "dataset/call_kw/res.partner/create", params);
  const data = await response.json();


  try {
    functions.logger.info("[create_user_in_Odoo2] User ("+ _data.name+") succesfully created in Odoo ("+ data.result+")", {
      "odoo_session": odoo_session,
      "id_user": data.result,
    });

    return data.result;
  } catch (error) {
    functions.logger.error("[create_user_in_Odoo2] Error creating user in Odoo", {
      "odoo_session": odoo_session,
      "params": params.body,
    });

    return 0;
  }
}

// export async function create_sale_order_and_invoice(odoo_session:any, crm_id : number, crm_name:string, res_id : number ) {
//   // creating order

//   const CustomHeaders: HeadersInit = {
//     "Content-Type": "application/json",
//     "Cookie": "session_id="+odoo_session,
//   };

//   let raw = JSON.stringify({
//     "params": {
//       "model": "sale.order",
//       "method": "create",
//       "kwargs": {},
//       "args": [

//         {"partner_id": res_id,
//           "note": "<p>[Backend] Requerimiento para instalar.</p>",
//           "opportunity_id": crm_id,
//           "origin": crm_name,
//           "show_update_pricelist": true,
//           "state": "sale",


//         },
//       ],
//     },
//   });

//   let params = {
//     headers: CustomHeaders,
//     method: "post",
//     body: raw,
//   };

//   let sale_order_id;

//   try {
//     const response = await fetch(settings.odoo_url + "dataset/call_kw/sale.order/create", params);
//     const data = await response.json();

//     sale_order_id = data.result;
//   } catch (err) {
//     functions.logger.error("[create_sale_order_and_invoice] ERROR 401: " + err, {"odoo_session": odoo_session} );
//     return false;
//   }

//   // creating sale.order.line

//   raw = JSON.stringify({
//     "params": {
//       "model": "sale.order.line",
//       "method": "create",
//       "kwargs": {},
//       "args": [
//         {"order_id": sale_order_id,
//           "product_id": 54,
//           "name": "Instalación baño al contado",
//           "product_uom": 1,
//           "product_uom_qty": 1.0,
//           "price_unit": 120.0,
//           "price_total": 120.0,
//           "discount": 83.33,

//         },
//       ],
//     },
//   });

//   params = {
//     headers: CustomHeaders,
//     method: "post",
//     body: raw,
//   };


//   try {
//     const response = await fetch(settings.odoo_url + "dataset/call_kw/sale.order.line/create", params);
//     const data = await response.json();

//     data.result;
//   } catch (err) {
//     functions.logger.error("[create_sale_order_and_invoice] ERROR 402: " + err, {"odoo_session": odoo_session} );
//     return false;
//   }


//   // modifying sale.order followers

//   raw = JSON.stringify({
//     "params": {
//       "model": "mail.followers",
//       "method": "create",
//       "kwargs": {},
//       "args": [
//         {"res_model": "sale.order",
//           "res_id": sale_order_id,
//           "partner_id": 3891,

//         },
//       ],
//     },
//   });

//   params = {
//     headers: CustomHeaders,
//     method: "post",
//     body: raw,
//   };


//   try {
//     const response = await fetch(settings.odoo_url + "dataset/call_kw/sale.order.line/create", params);
//     const data = await response.json();

//     data.result;
//   } catch (err) {
//     functions.logger.error("[create_sale_order_and_invoice] ERROR 403: " + err, {"odoo_session": odoo_session} );
//     return false;
//   }

//   // send to stack to check reference

//   let invoice_reference_stack_map = new Map();

//   invoice_reference_stack_map.set(res_id, crm_name);

//   const invoice_reference_stack_json = Object.fromEntries(invoice_reference_stack_map);
//   FirebaseFcn.firebaseUpdate("invoice_reference_stack", invoice_reference_stack_json);


//   return true;
// }

export async function read_accountmove_reference(odoo_session:any, array: any) {
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  const raw = JSON.stringify({
    "params": {
      "model": "account.move",
      "fields": ["partner_id", "ref"],
      "offset": 0,
      "domain": ["&", ["partner_id", "in", array], ["ref", "!=", ""]],
    },
  });

  const params_read = {
    headers: CustomHeaders,
    method: "post",
    body: raw,
  };

  try {
    const response_read = await fetch(settings.odoo_url + "dataset/search_read", params_read);
    const data_read = await response_read.json();

    // console.log("data_read", data_read)

    let user_payment = [];

    for (let i =0; i<data_read.result.length; i++) {
      user_payment.push(data_read.result.records[i].partner_id[0]);
    }


    return user_payment;
  } catch (error) {
    functions.logger.error("[read_accountmove_reference] ERROR 2410231411: " + error, {"odoo_session": odoo_session, "array": array} );
  }

  return [];
}

export async function verify_user_exist_create_modify(odoo_session:any, crm_data :any) {
  // verifica que un usuario existe, sino lo crea.
  // modifica la informacion del usuario

  // parameters deberia tener

  let partner_id;
  let new_crm_data;
  let user_data;

  try {
    if (crm_data.partner_id == false) {
      // partner_id = await create_user_in_Odoo(odoo_session, crm_data);
      // dont create any user
      new_crm_data = await get_crm_data(odoo_session, crm_data.id, null); // luego testeamos el bulk
    } else {
      partner_id = crm_data.partner_id[0];
      new_crm_data= crm_data;
    }

    user_data = await get_user_data(odoo_session, partner_id, null); // luego testeamos el bulk

    // update_user_in_firebase(new_crm_data, user_data);

    return {"crm_data": new_crm_data, "user_data": user_data};
  } catch (error) {
    functions.logger.error("[verify_user_exist_create_modify] ERROR 2110231732: " + error, {"odoo_session": odoo_session, crm_data} );
  }

  return false;
}

export async function get_crm_data(odoo_session:any, crm_id: number, since_timestamp : any) {
  /* esta funcion obtiene data de odoo CRM. si crm_id se ignora si existe since_timestamp*/
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  let raw;

  if (since_timestamp == 0 || since_timestamp == null) {
    raw = JSON.stringify({
      "params": {
        "model": "crm.lead",
        "offset": 0,
        "fields": [
          "id", "partner_id", "campaign_id", "stage_id", "medium_id", "source_id", "referred",
          "name", "phone", "mobile", "tag_ids", "create_uid", "create_date", "write_date", "street", "street2", "zip", "country_id", "state_id", "tag_ids", "user_id",
        ],
        "domain": [["id", "=", crm_id]],
      },
    });
  } else {
    const date = new Date(Number(since_timestamp));
    const date_str = "'"+ date.getFullYear()+"-"+("0" + (date.getMonth() + 1)).slice(-2)+"-"+("0" +date.getDate()).slice(-2)+" "+ ("0" +date.getHours()).slice(-2)+":"+("0" +date.getMinutes()).slice(-2)+":"+("0" +date.getSeconds()).slice(-2) + "'";

    raw = JSON.stringify({
      "params": {
        "model": "crm.lead",
        "offset": 0,
        "fields": [
          "id", "partner_id", "campaign_id", "stage_id", "medium_id", "source_id", "referred",
          "name", "phone", "mobile", "tag_ids", "create_uid", "create_date", "write_date", "street", "street2", "zip", "country_id", "state_id", "tag_ids", "user_id",
        ],
        "domain": [["write_date", ">", date_str]],
      },
    });
  }

  const params = {
    headers: CustomHeaders,
    method: "call",
    body: raw,
  };

  try {
    const response = await fetch(settings.odoo_url + "dataset/search_read", params);
    const data = await response.json();

    if (data.result.length<=1) return data.result.records[0];
    else return data.result.records;
  } catch (error) {
    functions.logger.error("[get_crm_data] ERROR 2110231807: " + error,
        {"odoo_session": odoo_session,
          "crm_id": crm_id,
          "since_timestamp": since_timestamp} );
    return false;
  }
}

export async function update_crm_data(odoo_session:any, crm_id: any, _data: any, ) {
  /* esta funcion obtiene data de odoo CRM. si crm_id se ignora si existe since_timestamp*/


  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  let raw = JSON.stringify({

    "params": {
      "model": "crm.lead",
      "method": "write",
      "kwargs": {},
      "args": [Number(crm_id), _data],
    },


  });

  const params = {
    headers: CustomHeaders,
    method: "call",
    body: raw,
  };

  try {
    const response = await fetch(settings.odoo_url + "dataset/call_kw/crm.lead/write", params);
    const data = await response.json();
    functions.logger.info( "[update_crm_data] Updating crm info with the following info", {
      "query": raw,
      "crm_id": crm_id,
      "_data": _data,
      "response": data,
    });

    return true;
  } catch (error) {
    functions.logger.error("[update_crm_data] ERROR 0211231653: " + error,
        {"odoo_session": odoo_session,
          "crm_id": crm_id} );
    return false;
  }
}

export async function update_user_data(odoo_session:any, user_id: any, _data: any) {
  /* esta funcion obtiene data de odoo CRM. si crm_id se ignora si existe since_timestamp*/
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  let raw = JSON.stringify({

    "params": {
      "model": "res.partner",
      "method": "write",
      "kwargs": {},
      "args": [Number(user_id), _data],
    },


  });


  const params = {
    headers: CustomHeaders,
    method: "call",
    body: raw,
  };

  try {
    const response = await fetch(settings.odoo_url + "dataset/call_kw/res.partner/write", params);
    const data = await response.json();

    functions.logger.info( "[update_user_data] Updating res.partner with the following info", {
      "query": raw,
      "user_id": user_id,
      "_data": _data,
      "response": data,
    });


    return true;
  } catch (error) {
    functions.logger.error("[update_user_data] ERROR 13121055: " + error,
        {"odoo_session": odoo_session,
          "user_id": user_id} );
    return false;
  }
}

export async function get_user_data(odoo_session:any, user_id: number, since_timestamp : any) {
  /* esta funcion obtiene data de odoo CRM. si crm_id se ignora si existe since_timestamp*/
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  let raw;

  if (since_timestamp == 0 || since_timestamp == null) {
    raw = JSON.stringify({
      "params": {
        "model": "res.partner",
        "offset": 0,
        "fields": [
          "is_company",
          "phone",
          "mobile",
          "name",
          "display_name",
          "vat",
          "l10n_latam_identification_type_id",
          "street",
          "street2",
          "country_id",
          "zip",
          "category_id",
          "city",
          "state_id",

          "tz",
          "tz_offset",
          "user_id",
          "same_vat_partner_id",
          "city_id",

          "opportunity_ids",
        ],
        "domain": [["id", "=", user_id]],
      },
    });
  } else {
    const date = new Date(Number(since_timestamp));
    const date_str = "'"+ date.getFullYear()+"-"+("0" + (date.getMonth() + 1)).slice(-2)+"-"+("0" +date.getDate()).slice(-2)+" "+ ("0" +date.getHours()).slice(-2)+":"+("0" +date.getMinutes()).slice(-2)+":"+("0" +date.getSeconds()).slice(-2) + "'";

    raw = JSON.stringify({
      "params": {
        "model": "res.partner",
        "offset": 0,
        "fields": [
          "is_company",
          "phone",
          "mobile",
          "name",
          "display_name",
          "vat",
          "l10n_latam_identification_type_id",
          "street",
          "street2",
          "country_id",
          "zip",
          "category_id",
          "city",
          "state_id",

          "tz",
          "tz_offset",
          "user_id",
          "same_vat_partner_id",
          "city_id",

          "opportunity_ids",
        ],
        "domain": [["write_date", ">", date_str]],
      },
    });
  }

  const params = {
    headers: CustomHeaders,
    method: "call",
    body: raw,
  };

  try {
    const response = await fetch(settings.odoo_url + "dataset/search_read", params);
    const data = await response.json();


    if (data.result.length<=1) return data.result.records[0];
    else return data.result.records;
  } catch (error) {
    functions.logger.error("[get_crm_data] ERROR 2110231907: " + error,
        {"odoo_session": odoo_session,
          "user_id": user_id,
          "since_timestamp": since_timestamp} );
    return false;
  }
}

export async function is_there_order_line(odoo_session:any, user_id: number) {
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  const raw = JSON.stringify({
    "params": {
      "model": "sale.order.line",
      "fields": [],
      "offset": 0,
      "domain": [["order_partner_id", "=", user_id], ["name", "ilike", "Instalación baño al contado"]],
    },
  });

  const params = {
    headers: CustomHeaders,
    method: "call",
    body: raw,
  };

  try {
    const response = await fetch(settings.odoo_url + "dataset/search_read", params);
    const data = await response.json();
    return data.result.length>0;
  } catch (error) {
    functions.logger.error("[get_crm_data] ERROR 2210232307: " + error,
        {"odoo_session": odoo_session,
          "user_id": user_id} );
    return false;
  }
}

export async function modify_state_user(odoo_session:any, user_data: any, state: number, mode: string) {
  // 453 - usuario por instalar
  // 358 - usuario activo
  // {id, category_id}


  try {
    let user_id = user_data.id;
    let categories_list : any[] = user_data.category_id;

    functions.logger.info("tentativa de "+ mode + " el estado "+ state + " al usuario " + user_id);

    const index_category = categories_list.indexOf(state);


    if (mode == "add") {
      if (index_category == -1 ) {
      // si no existe añadir
        categories_list.push(state);
      } else {
      // si existe no hacer nada

      }
    } else {
    // remove
      if (index_category == -1 ) {
      // si no existe no hacer nada


      } else {
      // si existe remover
        categories_list.splice(index_category, 1);
      }
    }

    functions.logger.info("categories_list ", categories_list);


    const CustomHeaders: HeadersInit = {
      "Content-Type": "application/json",
      "Cookie": "session_id="+odoo_session,
    };

    const raw = JSON.stringify({

      "params": {
        "model": "res.partner",
        "method": "write",
        "kwargs": {},
        "args": [
          user_id,
          {
            "category_id": categories_list,
          },
        ],
      },
    });

    const params = {
      headers: CustomHeaders,
      method: "write",
      body: raw,
    };


    const response = await fetch(settings.odoo_url + "dataset/call_kw/res.partner/", params);
    const data = await response.json();
    // console.log("data ", data)
    return data.result;
  } catch (error) {
    return false;
  }
}

export async function create_helpdesk_ticket(odoo_session:any, user_id: number, user_name: string) {
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  const raw = JSON.stringify({

    "params": {
      "model": "helpdesk.ticket",
      "method": "create",
      "kwargs": {},
      "args": [
        {
          "partner_id": user_id,
          "description": "",
          "name": user_name,
          "team_id": 17,
          "tag_ids": [278], // before 14
          "priority": "3",


        },
      ],
    },
  });

  const params = {
    headers: CustomHeaders,
    method: "write",
    body: raw,
  };

  const response = await fetch(settings.odoo_url + "dataset/call_kw/helpdesk.ticket/create", params);
  const data = await response.json();

  return data.result;
}

export async function odooToFirebase_Users_test(odoo_session:any, lastupdateTimestamp:any) {
  if (lastupdateTimestamp==null) lastupdateTimestamp = 0;
  const date = new Date(Number(lastupdateTimestamp));
  const date_str = "'"+ date.getFullYear()+"-"+("0" + (date.getMonth() + 1)).slice(-2)+"-"+("0" +date.getDate()).slice(-2)+" "+ ("0" +date.getHours()).slice(-2)+":"+("0" +date.getMinutes()).slice(-2)+":"+("0" +date.getSeconds()).slice(-2) + "'";
  // console.log(date_str);
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  let categories_list;

  // first obtain all categories
  try {
    categories_list = await getCategories(odoo_session);
    if (categories_list.length == 0) {
      functions.logger.error( "[odooToFirebase_Users] ERROR No categories: ", {"odoo_session": odoo_session} );
      return false;
    }
  } catch (error) {
    functions.logger.error( "[odooToFirebase_Users] ERROR No categories: " + error, {"odoo_session": odoo_session} );
    return false;
  }

  // console.log("cate list ", categories_list)


  try {
    const raw = JSON.stringify({
      "params": {
        "model": "res.partner",
        "offset": 0,
        "fields": [
          "id", "write_date"],
        "domain": [["write_date", ">", date_str]],
      },
    });

    const params = {
      headers: CustomHeaders,
      method: "post",
      body: raw,
    };
    const response = await fetch(settings.odoo_url + "dataset/search_read/", params);
    let odoo_query_time = Date.now(); // THIS IS THE TIME WHERE I MADE THE CHECK
    console.log("odoo_query_time final", odoo_query_time);
    let data;
    data = await response.json();

    const qtty_users = data.result.length;

    let entries = data.result.records;
    console.log("data", entries);

    let entries_sorted = entries.sort((e:any, f:any) => Date.parse(e.write_date) - Date.parse(f.write_date));

    console.log("entries_sorted", entries_sorted);

    for (let i= 0; i<40; i++) {
      console.log("odoo_query_time", entries_sorted[i].write_date);
      odoo_query_time = Date.parse(entries_sorted[i].write_date);
    }


    console.log("qtty_users", qtty_users);
    console.log("odoo_query_time final", odoo_query_time);

    return true;
  } catch (error) {
    functions.logger.error( "[odooToFirebase_Users] ERROR: " + error, {"odoo_session": odoo_session} );
    return false;
  }
}

export async function readInventory_Odoo(odoo_session:any) {
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  try {
    const raw = JSON.stringify({
      "params": {
        "model": "product.product",
        "fields": ["id", "barcode", "code", "name"],
        // "fields":["id","display_name","uom_name"],
        "offset": 0,
        // "domain":[["name","ilike","tubo de ve"]]
        "domain": [],
        // "limit": 100,
      },
    });

    const params = {
      headers: CustomHeaders,
      method: "post",
      body: raw,
    };

    const response = await fetch(settings.odoo_url + "dataset/search_read/", params);


    let data = await response.json();

    let items = data.result.records;
    let len =data.result.length;

    console.log("len", len);

    /*

    let sorted_items = items.sort((a:any, b:any) => {
      if (a.name == b.name) {
        return 0;
      }
      if (a.name < b.name) {
        return -1;
      }
      return 1;
    });

    console.log("sorted_items", sorted_items);

    let inventory_map = new Map();
    for (let i = 0; i < 100; i++) {
      inventory_map.set(sorted_items[i].id, sorted_items[i].name);
    }

    */

    // items = items.sort((a:any, b:any) => {
    //   if (a.barcode == b.barcode) {
    //     return 0;
    //   }
    //   if (a.barcode < b.barcode) {
    //     return -1;
    //   }
    //   if(a.barcode == false) {
    //     return -1;
    //   }

    //   return 1
    // });

    // filter barcode false, sort them and merge.

    let inventory_map = new Map();

    for (let i = 0; i < len; i++) {
      inventory_map.set(items[i].id, items[i].name);
    }

    return inventory_map;
  } catch (error) {
    functions.logger.error( "[odooToFirebase_Users] ERROR: " + error, {"odoo_session": odoo_session} );
    return false;
  }
}

export async function getItemsCollection(odoo_session:any) {
  // function needed [firebaseToOdoo_stock]
  // function needed [firebaseToOdoo_stock]
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  try {
    const raw = JSON.stringify({
      "params": {
        "model": "product.product",
        "fields": ["id", "name"],
        // "fields":["id","display_name","uom_name"],
        "offset": 0,
        // "domain":[["name","ilike","tubo de ve"]]
        "domain": [],
        // "limit": 100,
      },
    });

    const params = {
      headers: CustomHeaders,
      method: "post",
      body: raw,
    };

    const response = await fetch(settings.odoo_url + "dataset/search_read/", params);


    let data = await response.json();

    let items = data.result.records;
    let len =data.result.length;

    let inventory_map = new Map();

    for (let i = 0; i < len; i++) {
      inventory_map.set( items[i].name, items[i].id);
    }

    // const res_json = Object.fromEntries(inventory_map)
    // /console.log(res_json);

    return inventory_map;
  } catch (error) {
    // functions.logger.error( "[getItemsCollection] ERROR: " + error, {"odoo_session": odoo_session} );
    return false;
  }
}

export async function readZones_Odoo(odoo_session:any) {
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  try {
    const raw = JSON.stringify({
      "params": {
        "model": "crm.tag",
        "fields": ["name"],
        "offset": 0,
        "domain": [],
      },
    });

    const params = {
      headers: CustomHeaders,
      method: "post",
      body: raw,
    };

    const response = await fetch(settings.odoo_url + "dataset/search_read/", params);


    let data = await response.json();

    let items = data.result.records;
    let len =data.result.length;

    // console.log("len", len);

    let inventory_map = new Map();

    for (let i = 0; i < len; i++) {
      inventory_map.set( items[i].name, items[i].id);
    }

    return inventory_map;
  } catch (error) {
    functions.logger.error( "[readZones_Odoo] ERROR: " + error, {"odoo_session": odoo_session} );
    return false;
  }
}


export async function readMedia_Odoo(odoo_session:any) {
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  try {
    const raw = JSON.stringify({
      "params": {
        "model": "utm.medium",
        "fields": ["name"],
        "offset": 0,
        "domain": [],
      },
    });

    const params = {
      headers: CustomHeaders,
      method: "post",
      body: raw,
    };

    const response = await fetch(settings.odoo_url + "dataset/search_read/", params);


    let data = await response.json();

    let items = data.result.records;
    let len =data.result.length;

    // console.log("len", len);

    let inventory_map = new Map();

    for (let i = 0; i < len; i++) {
      inventory_map.set( items[i].name, items[i].id);
    }

    return inventory_map;
  } catch (error) {
    functions.logger.error( "[readMedia_Odoo] ERROR: " + error, {"odoo_session": odoo_session} );
    return false;
  }
}

export async function readSources_Odoo(odoo_session:any) {
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  try {
    const raw = JSON.stringify({
      "params": {
        "model": "utm.source",
        "fields": ["name"],
        "offset": 0,
        "domain": [],
      },
    });

    const params = {
      headers: CustomHeaders,
      method: "post",
      body: raw,
    };

    const response = await fetch(settings.odoo_url + "dataset/search_read/", params);


    let data = await response.json();

    let items = data.result.records;
    let len =data.result.length;

    // console.log("len", len);

    let inventory_map = new Map();

    for (let i = 0; i < len; i++) {
      inventory_map.set( items[i].name, items[i].id);
    }

    return inventory_map;
  } catch (error) {
    functions.logger.error( "[readSources_Odoo] ERROR: " + error, {"odoo_session": odoo_session} );
    return false;
  }
}

export async function checkUserNoCRM(odoo_session:any) {
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  try {
    const raw = JSON.stringify({
      "params": {
        "model": "res.partner",
        "fields": [
          "write_date",
          // "is_company",
          "phone",
          "mobile",
          "display_name",
          "vat",
          "l10n_latam_identification_type_id",
          "street",
          "street_name",
          "street2",
          "country_id",
          "zip",
          "category_id",
          "city",
          "state_id",
          "tz",
          "tz_offset",
          "user_id",
          "same_vat_partner_id",
          "city_id",
          "category_id",
          "function",
        ],
        "offset": 0,
        // "limit": 10,
        "domain": [
          "&",
          [
            "opportunity_ids",
            "=",
            false,
          ],
          [
            "is_company",
            "=",
            false,
          ],
        ],
      },
    });

    const params = {
      headers: CustomHeaders,
      method: "post",
      body: raw,
    };

    const response = await fetch(settings.odoo_url + "dataset/search_read/", params);


    let data = await response.json();


    let user_data = data.result.records;
    // let len =data.result.length;
    console.log(user_data);

    return user_data;
  } catch (error) {
    functions.logger.error( "[checkUserNoCRM] ERROR: " + error, {"odoo_session": odoo_session} );
    return false;
  }
}


export async function askcrmid(odoo_session:any, user_id : any) {
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  try {
    const raw = JSON.stringify({
      "params": {
        "model": "res.partner",
        "fields": [
          "opportunity_ids",
        ],
        "offset": 0,
        "domain": [
          [
            "id",
            "=",
            user_id,
          ],
        ],
      },
    });

    const params = {
      headers: CustomHeaders,
      method: "post",
      body: raw,
    };

    const response = await fetch(settings.odoo_url + "dataset/search_read/", params);


    let data = await response.json();


    let user_data = data.result.records;
    // let len =data.result.length;

    console.log("user_data ", user_data);

    return user_data[0].opportunity_ids[0];
  } catch (error) {
    functions.logger.error( "[readSources_Odoo] ERROR: " + error, {"odoo_session": odoo_session} );
    return false;
  }
}


export async function RewriteTestUsers(odoo_session:any) {
  try {
    const CustomHeaders: HeadersInit = {
      "Content-Type": "application/json",
      "Cookie": "session_id="+odoo_session,
    };


    let raw = JSON.stringify({
      "params": {
        "model": "res.partner",
        "fields": [
          "id",
          // "write_date",
          // "is_company",
          "phone",
          "mobile",
          "display_name",
          "vat",
          // "l10n_latam_identification_type_id",
          "street_name",
          // "country_id",
          "zip",
          "category_id",
          // "city",
          "state_id",
          // "tz",
          // "tz_offset",
          // "user_id",
          // "same_vat_partner_id",
          // "city_id",
          "category_id",
          // "function",
          "opportunity_ids",
        ],
        "offset": 0,
        // "limit": 10,
        "domain": [

          [
            "is_company",
            "=",
            false,
          ],
          // [ "id", "=", 30910]
        ],
      },
    });

    let params = {
      headers: CustomHeaders,
      method: "post",
      body: raw,
    };


    let response = await fetch(settings.odoo_url + "dataset/search_read/", params);


    let data = await response.json();


    let users_from_Odoo = data.result.records;


    let users_from_firebase = await FirebaseFcn.firebaseGet("Data_client" );
    // console.log(users_from_firebase);
    let users_keys = Object.keys(users_from_firebase);
    // users_keys = ['30910']
    // console.log(users_keys);


    let total = 0;
    let ids2discriminate = [];

    let categories_list = await getCategories(odoo_session);

    let crm_data_from_Odoo;


    for (let user of users_keys) {
      try {
        let odoo_user = users_from_Odoo.filter((odoo_e:any) => odoo_e.id == user);

        // console.log(odoo_user);


        let data_from_Odoo = {
          "id": odoo_user[0].id,
          "display_name": odoo_user[0].display_name,
          "vat": odoo_user[0].vat,
          "street_name": odoo_user[0].street_name,
          "opportunity_id": odoo_user[0].opportunity_ids[0],
          "phone": odoo_user[0].phone,
          "mobile": odoo_user[0].mobile,
          "zip": odoo_user[0].zip,
          "category_id": odoo_user[0].category_id,


        };

        let data_from_firebase = {
          "display_name": users_from_firebase[user].Data_client_1.Name_1,


        };

        if ( data_from_firebase.display_name.includes( data_from_Odoo.display_name) || data_from_Odoo.display_name.includes( data_from_firebase.display_name)) {
          null;
        } else {
          total = total + 1;
          console.log("------ ", user);

          try {
            ids2discriminate.push(data_from_Odoo.id);

            // download crm data
            try {
              raw = JSON.stringify({
                "params": {
                  "model": "crm.lead",
                  "offset": 0,
                  "fields": [
                    "id", "partner_id", "campaign_id", "stage_id", "medium_id", "source_id", "referred",
                    "name", "phone", "mobile", "tag_ids", "create_uid", "create_date", "write_date", "street", "street2", "zip", "country_id", "state_id", "tag_ids", "user_id",

                  ],
                  "domain": [["partner_id", "=", data_from_Odoo.id]],
                },
              });

              params = {
                headers: CustomHeaders,
                method: "post",
                body: raw,
              };

              response = await fetch(settings.odoo_url + "dataset/search_read/", params);


              let crm_data = await response.json();


              crm_data_from_Odoo = crm_data.result.records[0];

              console.log( "user ", {
                "data_from_firebase": data_from_firebase,
                "data_from_Odoo": data_from_Odoo,
                "crm_data_from_Odoo": crm_data_from_Odoo,

              });
            } catch (error) {
              console.log("there is an error. It seems like there is no crm data. user ", data_from_Odoo.id);
            }

            const tag_ids = crm_data_from_Odoo.tag_ids;
            // tag_ids defines ticket type acording the relation below
            let ticket_type = "Otro";
            if (tag_ids.includes(2)) ticket_type = "Ventas-Pamplona";
            if (tag_ids.includes(3)) ticket_type = "Ventas-Accu";

            console.log("tag_ids", tag_ids);


            let user_status_data;

            let user_categories_filtered = await search_categories_Odoo( data_from_Odoo.category_id, categories_list );
            // console.log("user_categories_filtered: ", user_categories_filtered);


            // STOPS ----------------------------------------------------------------
            const user_stop_data = user_categories_filtered.filter( (e:any) => e.name.includes("Paradero:"));
            // ROUTES ----------------------------------------------------------------
            const user_route_data = user_categories_filtered.filter( (e:any) => e.name.includes("Ruta:"));
            // ESTADO ----------------------------------------------------------------

            let Client_Type = "NaN";
            const stage_id = Number(crm_data_from_Odoo.stage_id[0]);
            switch (stage_id) {
              case 1:
                Client_Type = "Cliente Potencial";
                break;
              case 2:
                Client_Type = "Cliente con firma";
                break;
              case 3:
                Client_Type = "Cliente con Venta perdida";
                break;
              case 4:
                // if (data_from_Odoo.category_id.includes(358)) Client_Type = "Cliente por instalar";
                user_status_data = user_categories_filtered.filter( (e:any) => e.name.includes("usuario activo") || e.name.includes("usuario inactivo") || e.name.includes("Usuario por instalar"));
                // 453 - usuario por instalar
                // 358 - usuario activo
                if (user_status_data[0].id == 358) Client_Type = "Cliente normal";
                else if (user_status_data[0].id == 453) Client_Type = "Cliente por instalar";
                else Client_Type = "Cliente ganado";
                break;
              default:
                break;
            }

            console.log("client_type", Client_Type);

            console.log("user_status_data: ", user_status_data);
            console.log("user_route_data: ", user_route_data);
            console.log("user_stop_data: ", user_stop_data);


            const Data_client_1 = {
              "Addr_reference": "NaN",
              "Address": data_from_Odoo.street_name?data_from_Odoo.street_name: "NaN",
              "Birth_date": "000000", // Created in app
              "Campaign_month": crm_data_from_Odoo.campaign_id?crm_data_from_Odoo.campaign_id:"NaN", // Created in app
              "Client_Community": "NaN",
              "Country": "Perú",
              "DNI": data_from_Odoo.vat? data_from_Odoo.vat: "NaN",
              "How_know_us": crm_data_from_Odoo.medium_id?crm_data_from_Odoo.medium_id:"NaN", // Created in app
              "How_know_us_method": crm_data_from_Odoo.source_id?crm_data_from_Odoo.source_id:"NaN", // Created in Odoo
              "How_know_us_referals": crm_data_from_Odoo.referred?crm_data_from_Odoo.referred:"NaN",
              "Last_name_1": "",
              "Last_name_2": "",
              "Lost_client_reason": "NaN",
              "Name_1": data_from_Odoo.display_name? data_from_Odoo.display_name: "NaN",
              "Name_2": "",
              "Name_potencial": data_from_Odoo.display_name? data_from_Odoo.display_name: "NaN",
              "Phone1": data_from_Odoo.phone,
              "Phone2": data_from_Odoo.mobile,
              "Sales_person": crm_data_from_Odoo.user_id[1],
              "Sales_person_Commit": "NaN",
              "Urine_preference": "NaN",
              "Zone": ticket_type,
              "ubigeo": data_from_Odoo.zip,
            };

            const Data_client_2 = {
              "Client_Type": Client_Type,
              "Group_Client_type": "Comercial",
              "Lat": 0.0,
              "Long": 0.0,
              "Route": user_route_data[0]?.name? user_route_data[0].name: "NaN",
              "Stops": user_stop_data[0]?.name? user_stop_data[0].name: "NaN",
              "idRoute": user_route_data[0]?.id? user_route_data[0].id: 0,
              "idStop": user_stop_data[0]?.id? user_stop_data[0].id: 0,
            };

            const Data_client_3 = {
              "Addr": data_from_Odoo.street_name? data_from_Odoo.street_name: "NaN",
              "Addr_reference": "NaN",
              "Name_complete": data_from_Odoo.display_name? data_from_Odoo.display_name: "NaN",
              "Phone1": data_from_Odoo.phone ? data_from_Odoo.phone : "NaN",
              "Phone2": data_from_Odoo.mobile? data_from_Odoo.mobile : "NaN",
              "client_coment_OPE": "NaN",
              "client_type": Client_Type,
            };

            const dataClient_node = {
              "Data_client_1": Data_client_1,
              "Data_client_2": Data_client_2,
              "Data_client_3": Data_client_3,
            };

            console.log("dataCient_node", dataClient_node);
            FirebaseFcn.firebaseSet("Data_client/" + user, dataClient_node);
          } catch (error) {
            console.log( "NO ODOO user ", {
              "data_from_firebase": data_from_firebase,
            });
          }
        }
      } catch (err) {
        //  console.log( "err ", )

      }
    }


    console.log( "total " + total );

    // se borra el nodo de firebase y se reescribe con la info de odoo.


    // await update_node_data(ids2discriminate)
    // return user_data;
    return ids2discriminate;
  } catch (error) {
    functions.logger.error( "[checkUserNoCRM] ERROR: " + error, {"odoo_session": odoo_session} );
    return false;
  }
}


