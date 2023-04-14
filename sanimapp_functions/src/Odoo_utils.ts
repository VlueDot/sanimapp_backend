import fetch from "node-fetch";
import * as settings from "./GlobalSetting";
import * as functions from "firebase-functions";
import * as FirebaseFcn from "./Firebase_utils";


let info = {
  "odoo_session": 0,
  "user_id_odoo": 0,
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
      functions.logger.info("[odoo_Login] Odoo Authentication Succeeded.", {"odoo_session": odoo_session});
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
  if (response.status === 200) {
    functions.logger.info( "[odoo_Logout] Odoo Logout Succeeded. ", {"odoo_session": odoo_session});
  } else functions.logger.error("[odoo_Logout] OdooLogout Error: unexpected " + response.status, {"odoo_session": odoo_session});

  return response.status;
}

export async function odooToFirebase_CRM_Campaigns(odoo_session:any) {
  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  const raw = JSON.stringify({
    "params": {
      "model": "utm.campaign",
    },
  });

  const params = {
    headers: CustomHeaders,
    method: "post",
    body: raw,
  };


  const response = await fetch(settings.odoo_url + "dataset/search_read", params);
  const data = await response.json();

  if (response.status == 200) {
    try {
      functions.logger.info( "[OdooToFirebase_CRM] Odoo request Succeeded. "+data["result"]["length"] + " records");


      const map = new Map();
      let id : any;
      let name : string;


      for (let i = 0, len = data["result"]["records"].length; i < len; i++) {
        id = data["result"]["records"][i]["id"];
        name = data["result"]["records"][i]["name"];

        map.set(id, name);
      }

      const firebase_json = Object.fromEntries(map);
      const res = await FirebaseFcn.firebaseSet("campaign_names", firebase_json);

      if (res) {
        functions.logger.info("[OdooToFirebase_CRM]  Campaings : Firebase successfully updated");
        return true;
      } else {
        functions.logger.error("[OdooToFirebase_CRM]  Campaings : Firebase updated failure");
      }
    } catch (error) {
      try {
        functions.logger.error( "[OdooToFirebase_CRM] Code:" +data["error"]["code"] + ": "+ data["error"]["message"]);
      } catch {
        functions.logger.error( "[OdooToFirebase_CRM] ERROR: ", error);
      }
    }
  } else functions.logger.error("[OdooToFirebase_CRM] Odoo request Error: unexpected " + response.status);

  return null;
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


async function odooToFirebase_Users(odoo_session:any, lastupdateTimestamp:any) {
  const date = new Date(Number(lastupdateTimestamp));
  const date_str = "'"+ date.getFullYear()+"-"+("0" + (date.getMonth() + 1)).slice(-2)+"-"+("0" +date.getDate()).slice(-2)+" "+ ("0" +date.getHours()).slice(-2)+":"+("0" +date.getMinutes()).slice(-2)+":"+("0" +date.getSeconds()).slice(-2) + "'";

  const CustomHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "Cookie": "session_id="+odoo_session,
  };

  const raw = JSON.stringify({
    "params": {
      "model": "res.partner",
      "offset": 0,
      "fields": [
        "id", "phone", "mobile", "surname", "mother_name", "first_name", "middle_name",
        "vat", "street", "display_name", "category_id", "l10n_pe_ubigeo", "write_date"],
      "domain": [["write_date", ">", date_str]],
    },
  });

  const params = {
    headers: CustomHeaders,
    method: "post",
    body: raw,
  };

  try {
    const response = await fetch(settings.odoo_url + "dataset/search_read/", params);
    const data = await response.json();

    const qtty_users = data.result.length;
    if (qtty_users > 0) {
      const fb_stops = await FirebaseFcn.firebaseGet("stops");
      const keys = Object.keys(fb_stops);

      const fb_routes = await FirebaseFcn.firebaseGet("Route_definition");
      const keys_routes = Object.keys(fb_routes);

      const target_data = data.result.records;
      functions.logger.info( "[odooToFirebase_Users] Entries Founded:  ",
          {"odoo_session": odoo_session,
            "target_data": target_data,
          } );


      for (let i= 0; i<qtty_users; i++) {
        const user_id = target_data[i].id;
        const user_categories = target_data[i].category_id;

        try {
          // check for categories
          // alternatively we could download every stops and categories. depending on demand or testings

          // STOPS ----------------------------------------------------------------


          const user_stop_data = await checkingCategoriesOdoo( CustomHeaders, user_categories, "paradero" );

          let user_stopId = 0; let user_namestop = "NaN";

          if (user_stop_data.result.length > 0) {
            user_stopId = user_stop_data.result.records[0].id;
            user_namestop = user_stop_data.result.records[0].name;
          }

          let ubigeo = "NaN";
          if (target_data[i].l10n_pe_ubigeo != false) ubigeo = target_data[i].l10n_pe_ubigeo;

          let phone1 = "NaN";
          if (target_data[i].phone != false) phone1 = target_data[i].phone;

          let phone2 = "NaN";
          if (target_data[i].mobile != false) phone2 = target_data[i].mobile;

          let name_1 = "NaN";
          if (target_data[i].first_name != false) name_1 = target_data[i].first_name;

          let name_2 = "NaN";
          if (target_data[i].middle_name != false) name_2 = target_data[i].middle_name;

          let address = "NaN";
          if (target_data[i].street != false) address = target_data[i].street;

          let dni = "NaN";
          if (target_data[i].vat != false) dni = target_data[i].vat;

          let last_name_1 = "NaN";
          if (target_data[i].surname != false) last_name_1 = target_data[i].surname;

          let last_name_2 = "NaN";
          if (target_data[i].mother_name != false) last_name_2 = target_data[i].mother_name;

          // ROUTES ----------------------------------------------------------------

          const user_route_data = await checkingCategoriesOdoo( CustomHeaders, user_categories, "ruta" );
          let user_routeId = 0; let user_nameroute = "NaN";


          if (user_route_data.result.length > 0) {
            user_routeId = user_route_data.result.records[0].id;
            user_nameroute = user_route_data.result.records[0].name;
          }

          const initialOdoo_routeId = user_routeId;

          // ESTADO ----------------------------------------------------------------

          const user_status_data = await checkingCategoriesOdoo( CustomHeaders, user_categories, "estado" );

          let user_status_name ="Cliente con firma";
          if (user_status_data.result.length > 0) {
            if ( user_status_data.result.records[0].name == "Usuario por instalar") user_status_name = "Cliente por instalar";
            else if ( user_status_data.result.records[0].name == "usuario activo") user_status_name = "Cliente normal"; // NEEDED TO DEFINE A DEFAULT USER STATUS
            else if ( user_status_data.result.records[0].name == "usuario inactivo") user_status_name = "Cliente desinstalado";
          } else {
            functions.logger.info( "[odooToFirebase_Users] WARNING! There is no state for client " + user_id, {
              "odoo_session": odoo_session,
              "user_id_odoo": user_id,
              "warning_label": true,
            });
          }


          // ------------------------------ GET FROM FIREBASE

          let stop_id_odoo_fromDataClient2 = 0;
          let stop_id_firebase = 0;
          let stop_name_fromDataClient2 = "NaN";

          let route_id_odoo_fromDataClient2 = 0;
          let route_id_firebase = 0;
          let route_name_fromDataClient2 = "NaN ";

          try {
            const dataclient2_from_FB = await FirebaseFcn.firebaseGet("Data_client/" + user_id +"/Data_client_2/" );
            stop_id_odoo_fromDataClient2 = dataclient2_from_FB["idStop"];
            stop_id_firebase = dataclient2_from_FB["stop_id_firebase"];
            stop_name_fromDataClient2 = dataclient2_from_FB["Stops"];

            route_id_odoo_fromDataClient2 = dataclient2_from_FB["idRoute"];
            route_id_firebase = dataclient2_from_FB["route_id_firebase"];
            route_name_fromDataClient2 = dataclient2_from_FB["Route"];

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
                "Last_name_1": last_name_1,
                "Last_name_2": last_name_2,
                "Lost_client_reason": "NaN",
                "Name_1": name_1,
                "Name_2": name_2,
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
                "Group_Client_type": "Comercial", //
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
              "user_id_odoo": user_id,
              "warning_label": true,
            });
            FirebaseFcn.firebaseSet("Data_client/" + user_id, dataClient_node);
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

          };

          const ToDoList = [];
          const stops_changed = initialState.stop_id_odoo != targetState.stop_id_odoo;
          const just_routes_changed = initialOdoo_routeId != targetState.route_id_odoo && !stops_changed;
          const just_no_route = targetState.route_id_odoo == 0 && targetState.stop_id_odoo != 0 && !stops_changed;
          if (stops_changed) ToDoList.push("Stops changed: " + initialState.stop_id_odoo +" -> " + targetState.stop_id_odoo);
          if ( just_routes_changed) ToDoList.push("Routes changed: " + initialOdoo_routeId +" -> " + targetState.route_id_odoo);
          if ( just_no_route ) ToDoList.push("There is no route in odoo");
          if (!stops_changed && !just_no_route && ! just_routes_changed) ToDoList.push("Nothing to do.");


          functions.logger.info( "[odooToFirebase_Users] Tasks. ",
              {
                "odoo_session": odoo_session,
                "user_id_odoo": user_id,
                "to-do-list": ToDoList,
                "initialState": initialState,
                "targetState": targetState,

              });


          info = {
            "odoo_session": odoo_session,
            "user_id_odoo": user_id,
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
            console.log("just_no_route");
          }


          const dateTime = Date.now();
          FirebaseFcn.firebaseSet("/timestamp_collection/ussersTimeStamp", String(dateTime));
          functions.logger.info( "[odooToFirebase_Users] updating ussersTimeStamp in Firebase", {
            "odoo_session": odoo_session,
            "userTimestamp": String(dateTime),
          } );
        } catch (error) {
          functions.logger.error( "[odooToFirebase_Users] ERROR: error updating user " + user_id, {
            "odoo_session": odoo_session,
            "user_id": user_id,
          } );
          FirebaseFcn.firebaseSet("/Backend/Errors/odooToFirebase_Users/"+user_id, {
            "odoo_session": odoo_session,
            "user_id": user_id,
            "target_userCategories": user_categories,
          } );
        }
      }
    } else functions.logger.info( "[odooToFirebase_Users] No update founded in Odoo.", {"odoo_session": odoo_session});
  } catch (err) {
    functions.logger.error( "[odooToFirebase_Users] ERROR: " + err, {"odoo_session": odoo_session} );
  }

  return null;
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

async function checkingCategoriesOdoo(CustomHeaders:any, user_categories: any, mode:string) {
  let criteria_array = [];
  if (mode == "estado") criteria_array = ["name", "in", ["usuario activo", "usuario inactivo", "Usuario por instalar"]];
  else criteria_array = ["name", "ilike", mode];

  try {
    const raw = JSON.stringify({
      "params": {
        "model": "res.partner.category",
        "fields": ["id", "name"],
        "offset": 0,
        "domain": ["&", ["id", "in", user_categories], criteria_array],
      },
    });

    const params = {
      headers: CustomHeaders,
      method: "post",
      body: raw,
    };

    const response = await fetch(settings.odoo_url + "dataset/search_read/", params);
    const res = await response.json();
    // console.log("response.json();", JSON.stringify(res))
    return res;
  } catch (err) {
    functions.logger.error( "[CheckingCategoriesOdoo] ERROR. ", {"error": err, "user_categories": user_categories});
    return {"result": {"records": []}};
  }
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
      "fields": ["id", "phone", "mobile", "comment", "surname", "mother_name", "first_name", "middle_name", "vat", "contact_address", "country_id", "l10n_pe_ubigeo", "display_name", "category_id"],
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

async function odooToFirebase_ServiceTickets(odoo_session:any, lastupdateTimestamp: any) {
  // The function reads the tickes of service created in odoo after the last update
  const serviceColletion= await FirebaseFcn.firebaseGet("/Service_collection");
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
    const len = data.result.length;
    // Only works if there is at least a new ticket
    if (len > 0) {
      const servCollKeys = Object.keys(serviceColletion); // list of tickets ids in Firebase
      const tickets = data.result.records;
      functions.logger.info( "[odooToFirebase_ServiceTickets] Entries Founded:", {
        "odoo_session": odoo_session,
        "target_data": tickets,
      });

      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        const id = String(ticket["id"]);

        try {
          // save the data readed from odoo, organizing it to write in Firebase
          const create_date = Date.parse(ticket["create_date"]);
          const creation_date = new Date(Number(create_date)-18000000);
          const create_date_str = creation_date.getFullYear()+"-"+("0" + (creation_date.getMonth() + 1)).slice(-2)+"-"+("0" +creation_date.getDate()).slice(-2)+" "+ ("0" +creation_date.getHours()).slice(-2)+":"+("0" +creation_date.getMinutes()).slice(-2)+":"+("0" +creation_date.getSeconds()).slice(-2);

          const partner_id = String(ticket["partner_id"][0]);
          const description = ticket["description"];
          const name = ticket["name"];

          const stage_id = Number(ticket["stage_id"][0]);
          // stage_id defines ticket status acording the relation below
          let ticket_status = "NaN";
          switch (stage_id) {
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
          if (tag_ids.includes(14)) ticket_type = "Instalación";
          if (tag_ids.includes(16)) ticket_type = "Desinstalación";

          // Use saved data to write in firebase depending on each case
          if (servCollKeys.includes(id)) {// **************************************************************************************
            // if ticket already exists in Firebase (Service_Collection) then just update some params
            // The updating depends on the current ticket status in firebase and the new ticket status from odoo

            const initialState = await FirebaseFcn.firebaseGet("/Service_collection/" + id);
            let targetState = initialState;

            // if ticket status is "Nuevo"--------------------------------------------------------------------------------------
            if (ticket_status === "Nuevo") {
              // just update if the current status is "Nuevo"
              if (serviceColletion[id]["ticket_status"] === "Nuevo") {
                targetState["id_client"] = Number(partner_id);
                targetState["ticket_commits"] = description;
                targetState["ticket_name"] = name;
                targetState["ticket_type"] = ticket_type;
              }
            }

            // if ticket status is "En progreso"--------------------------------------------------------------------------------
            if (ticket_status === "En progreso") {
              // just update if the current status is "Nuevo" or "En progreso"

              // If "Nuevo"
              if (serviceColletion[id]["ticket_status"] === "Nuevo") {
                targetState["id_client"] = Number(partner_id);
                targetState["ticket_commits"]= description;
                targetState["ticket_name"] = name;
                targetState["ticket_status"] = ticket_status;
                targetState["ticket_type"] = ticket_type;
                targetState["conflict_indicator"]= "Actualizado por Odoo";
              }

              // If "En progreso"
              if (serviceColletion[id]["ticket_status"] === "En progreso") {
                targetState["id_client"] = Number(partner_id);
                targetState["ticket_commits"] = description;
                targetState["ticket_name"] = name;
              }
            }

            // if ticket status is "Terminado"-----------------------------------------------------------------------------------
            if (ticket_status === "Terminado") {
              // just update if the current status is "Nuevo" or "En progreso"

              // If "Nuevo"
              if (serviceColletion[id]["ticket_status"] === "Nuevo") {
                targetState["id_client"] = Number(partner_id);
                targetState["ticket_commits"] = description;
                targetState["ticket_name"] = name;
                targetState["ticket_status"] = ticket_status;
                targetState["ticket_type"] = ticket_type;
              }

              // If "En progreso"
              if (serviceColletion[id]["ticket_status"] === "En progreso") {
                targetState["id_client"] = Number(partner_id);
                targetState["ticket_commits"] = description;
                targetState["ticket_name"] = name;
                targetState["ticket_status"] = ticket_status;
                targetState["ticket_type"] = ticket_type;
              }
            }
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

              let targetState = {
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
              }

              // In case, ticket type is install, it alse updates the client type in Firebase to "cliente por instalar"---------
              if (ticket_type === "Instalación") {
                let client_type_old_2 = await FirebaseFcn.firebaseGet("/Data_client/"+partner_id+"/Data_client_2/Client_Type");
                let client_type_old_3 = await FirebaseFcn.firebaseGet("/Data_client/"+partner_id+"/Data_client_3/client_type");
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

          const write_date = ticket["write_date"];
          const writing_date = Date.parse(write_date);
          FirebaseFcn.firebaseSet("/timestamp_collection/tickets_timestamp", String(writing_date));
          functions.logger.info( "[odooToFirebase_ServiceTickets] updating tickets_timestamp in Firebase", {
            "odoo_session": odoo_session,
            "tickets_timestamp": String(writing_date),
          });
        } catch (err) {
          functions.logger.error("[odooToFirebase_ServiceTickets] ERROR: " + err, {"odoo_session": odoo_session} );
        }
      }
    } else functions.logger.info( "[odooToFirebase_ServiceTickets] No service tickets founded in Odoo.", {"odoo_session": odoo_session});

    const dateTime = Date.now();
    FirebaseFcn.firebaseSet("/timestamp_collection/tickets_timestamp", String(dateTime));
    functions.logger.info( "[odooToFirebase_ServiceTickets] updating tickets_timestamp in Firebase", {
      "odoo_session": odoo_session,
      "tickets_timestamp": String(dateTime),
    } );
  } catch (err) {
    functions.logger.error("[odooToFirebase_ServiceTickets] ERROR: " + err, {"odoo_session": odoo_session} );
  }

  return null;
}

async function odooToFirebase_CRMTickets(odoo_session:any, lastupdateTimestamp: any) {
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
        "partner_id", "campaign_id", "stage_id", "medium_id", "source_id", "referred",
        "name", "phone", "mobile", "tag_ids", "create_uid", "create_date", "write_date",
      ],
      "domain": [["write_date", ">", date_str]],
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

    let update = false;
    // let letter = ""
    // Only works if there is at least a new ticket
    if (len > 0) {
      const tickets = data.result.records;
      functions.logger.info( "[odooToFirebase_CRMTickets] Entries Founded:", {
        "odoo_session": odoo_session,
        "target_data": tickets,
      });

      // for every ticket to write in firebase
      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        const ticket_id = String(ticket["id"]);

        // Saving info to write in firebase--------------------------------------------------------------------------------------------
        const stage_id = Number(ticket["stage_id"][0]);
        // stage_id defines ticket status acording the relation below
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
            ticket_status = "Cliente ganado";
            break;
          default:
            break;
        }

        let partner_id = "NaN";
        if (stage_id != 0) {
          partner_id = String(ticket["partner_id"][0]);
        }

        let campaign_id = "NaN";
        if (ticket["campaign_id"][1] != undefined) campaign_id = ticket["campaign_id"][1];

        let medium_id = "NaN";
        if (ticket["medium_id"][1] != undefined) medium_id = ticket["medium_id"][1];

        let source_id = "NaN";
        if (ticket["source_id"][1] != undefined) source_id = ticket["source_id"][1];

        let referred = ticket["referred"];
        if (referred === false) referred = "NaN";

        let name = ticket["name"];

        let phone = ticket["phone"];
        if (phone === false) phone = "NaN";

        let mobile = ticket["mobile"];
        if (mobile === false) mobile = "NaN";

        const tag_ids = ticket["tag_ids"];
        // tag_ids defines ticket type acording the relation below
        let ticket_type = "Otro";
        if (tag_ids.includes(2)) ticket_type = "Ventas-Pamplona";
        if (tag_ids.includes(3)) ticket_type = "Ventas-Accu";

        let create_uid = "NaN";
        if (ticket["create_uid"][1] != undefined) create_uid = ticket["create_uid"][1];

        const create_date = ticket["create_date"];

        // Writing in firebase with the info saved--------------------------------------------------------------------------------------

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

        const ToDoList = [];

        // Write in firebase depending on case++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        if (keys_potentials.includes(ticket_id)) {
          // ****************************************************************************************
          const potentialAddress = "/notRegisteredUsers/" + ticket_id;
          const initialState = await FirebaseFcn.firebaseGet(potentialAddress);
          let targetState = initialState;

          if (ticket_status === "Cliente Potencial") {
            ToDoList.push("Update notRegisteredUsers data");
            targetState["Campaign_month"] = campaign_id;
            targetState["How_know_us"] = medium_id;
            targetState["How_know_us_method"] = source_id;
            targetState["How_know_us_referals"] = referred;
            targetState["Name_potencial"] = name;
            targetState["Phone1"] = phone;
            targetState["Phone2"] = mobile;
            targetState["Sales_person"] = create_uid;
            targetState["Zone"] = ticket_type;

            functions.logger.info( "[odooToFirebase_CRMTickets] Tasks. ", {
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
              targetState["Sales_person"] = create_uid;
              targetState["Zone"] = ticket_type;
              functions.logger.info( "[odooToFirebase_CRMTickets] Tasks. ", {
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

                functions.logger.info( "[odooToFirebase_CRMTickets] Tasks. ", {
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
                  if (contactData["l10n_pe_ubigeo"] != false) ubigeo = contactData["l10n_pe_ubigeo"];

                  let address = "NaN";
                  if (contactData["contact_address"] != false) address = contactData["contact_address"];

                  let name_1 = "NaN";
                  if (contactData["first_name"] != false) name_1 = contactData["first_name"];

                  let name_2 = "NaN";
                  if (contactData["middle_name"] != false) name_2 = contactData["middle_name"];

                  let dni = "NaN";
                  if (contactData["vat"] != false) dni = contactData["vat"];

                  let last_name_1 = "NaN";
                  if (contactData["surname"] != false) last_name_1 = contactData["surname"];

                  let last_name_2 = "NaN";
                  if (contactData["mother_name"] != false) last_name_2 = contactData["mother_name"];

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
                    "Last_name_1": last_name_1,
                    "Last_name_2": last_name_2,
                    "Lost_client_reason": "NaN",
                    "Name_1": name_1,
                    "Name_2": name_2,
                    "Name_potencial": name,
                    "Phone1": phone1,
                    "Phone2": phone2,
                    "Sales_person": create_uid,
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

                  functions.logger.info( "[odooToFirebase_CRMTickets] Tasks. ", {
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

            functions.logger.info( "[odooToFirebase_CRMTickets] Tasks. ", {
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
                "Sales_person": create_uid,
                "Zone": ticket_type,
                "timeStampCreate": create_date, // line 1510
                "Sales_person_Commit": "NaN",
                "Lat": 0,
                "Long": 0,
                "Client_Type": ticket_status,
                "Client_Community": "NaN",
              };

              functions.logger.info( "[odooToFirebase_CRMTickets] Tasks. ", {
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

                functions.logger.info( "[odooToFirebase_CRMTickets] Tasks. ", {
                  "odoo_session": odoo_session,
                  "crm_id": ticket_id,
                  "user_id": partner_id,
                  "to-do-list": ToDoList,
                  "initialState": init,
                  "targetState": targ,
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
                  if (contactData["l10n_pe_ubigeo"] != false) ubigeo = contactData["l10n_pe_ubigeo"];

                  let address = "NaN";
                  if (contactData["contact_address"] != false) address = contactData["contact_address"];

                  let name_1 = "NaN";
                  if (contactData["first_name"] != false) name_1 = contactData["first_name"];

                  let name_2 = "NaN";
                  if (contactData["middle_name"] != false) name_2 = contactData["middle_name"];

                  let dni = "NaN";
                  if (contactData["vat"] != false) dni = contactData["vat"];

                  let last_name_1 = "NaN";
                  if (contactData["surname"] != false) last_name_1 = contactData["surname"];

                  let last_name_2 = "NaN";
                  if (contactData["mother_name"] != false) last_name_2 = contactData["mother_name"];

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
                    "Last_name_1": last_name_1,
                    "Last_name_2": last_name_2,
                    "Lost_client_reason": "NaN",
                    "Name_1": name_1,
                    "Name_2": name_2,
                    "Name_potencial": name,
                    "Phone1": phone1,
                    "Phone2": phone2,
                    "Sales_person": create_uid,
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

                  functions.logger.info( "[odooToFirebase_CRMTickets] Tasks. ", {
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

        const write_date = ticket["write_date"];
        const writing_date = Date.parse(write_date);
        FirebaseFcn.firebaseSet("/timestamp_collection/CMR_tickets_timestamp", String(writing_date));
        functions.logger.info( "[odooToFirebase_ServiceTickets] updating CMR_tickets_timestamp in Firebase", {
          "odoo_session": odoo_session,
          "CMR_tickets_timestamp": String(writing_date),
        });
      }
    } else functions.logger.info("[odooToFirebase_CRMTickets] No CRM tickets founded in Odoo.", {"odoo_session": odoo_session});

    if (update) {
      const dateTime = Date.now();
      FirebaseFcn.firebaseSet("/timestamp_collection/CMR_tickets_timestamp", String(dateTime));
      functions.logger.info( "[odooToFirebase_ServiceTickets] updating CMR_tickets_timestamp in Firebase", {
        "odoo_session": odoo_session,
        "CMR_tickets_timestamp": String(dateTime),
      });
    }

    // if (letter != "") Se envia el correo con la info en letter
  } catch (err) {
    functions.logger.error("[odooToFirebase_CRMTickets] ERROR: " + err, {"odoo_session": odoo_session} );
  }

  return null;
}

export async function odooToFirebase_all(odoo_session:any, lastupdateTimestamp_users: any, lastupdateTimestamp_tickets: any, lastupdateTimestamp_crm: any) {
  await odooToFirebase_CRMTickets(odoo_session, lastupdateTimestamp_crm);
  await odooToFirebase_Users(odoo_session, lastupdateTimestamp_users);
  await odooToFirebase_ServiceTickets(odoo_session, lastupdateTimestamp_tickets);
  // If awaits out, it doesnt work properly
  return null;
}

export async function firebaseToOdoo_ActiveOrInstall(odoo_session:any, active: boolean, partnerId: number) {
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
  let newTag = 358;
  if (active === false) newTag = 453;

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
