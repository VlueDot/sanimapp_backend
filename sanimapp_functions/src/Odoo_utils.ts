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


export async function odooToFirebase_Users(odoo_session:any, lastupdateTimestamp:any) {
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
        "vat", "contact_address", "display_name", "category_id"],
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
      const updatedusers = data.result.records;
      functions.logger.info( "[odooToFirebase_Users] Entries Founded:  ",
          {"odoo_session": odoo_session,
            "updatedusers": updatedusers,
          } );

      const fb_stops = await FirebaseFcn.firebaseGet("stops");
      // console.log("fb_stops  wadafaaaaq" ,fb_stops)
      const keys = Object.keys(fb_stops);

      for (let i= 0; i<qtty_users; i++) {
        const user_id = updatedusers[i].id;
        const user_categories = updatedusers[i].category_id;

        // check for categories
        // alternatively we could download every stops and categories. depending on demand or testings

        // STOPS ----------------------------------------------------------------


        const user_stop_data = await checkingCategoriesOdoo( CustomHeaders, user_categories, "paradero" );

        let user_stopId = 0; let user_namestop = "NaN";

        if (user_stop_data.result.length > 0) {
          user_stopId = user_stop_data.result.records[0].id;
          user_namestop = user_stop_data.result.records[0].name;
        }

        // ROUTES ----------------------------------------------------------------

        const user_route_data = await checkingCategoriesOdoo( CustomHeaders, user_categories, "ruta" );

        let user_routeId = 0; let user_nameroute = "NaN";

        if (user_route_data.result.length > 0) {
          user_routeId = user_route_data.result.records[0].id;
          user_nameroute = user_route_data.result.records[0].name;
        }

        // Update FIREBASE below ----------------------------------------------------------------

        info = {
          "odoo_session": odoo_session,
          "user_id_odoo": user_id,
          "stop_id_odoo": user_stopId,
          "stop_id_firebase": 0,
          "stop_name": user_namestop,
          "route_id_odoo": user_routeId,
          "route_id_firebase": 0,
          "route_name": user_nameroute,

        };


        // we NEED to save task somewhere in case of failure.
        // try {
        //   FirebaseFcn.firebaseUpdate("Tasks", task);
        // } catch (err) {
        //   functions.logger.error( "[odooToFirebase_Users] Error pushing Tasks. ", {"error": err, "user_id": user_id} );
        //   return null;
        // }

        // 0. Auxiliary functions  INFO HAS ODOO INFO
        const dataclient2_from_FB = await FirebaseFcn.firebaseGet("Data_client/" + user_id +"/Data_client_2/" );
        const stop_from_FBdataclient2_idStop = dataclient2_from_FB["idStop"];
        const stop_from_FBdataclient2_nameStop = dataclient2_from_FB["Stops"];
        const route_from_FBdataclient2_idRoute = dataclient2_from_FB["idRoute"];
        // const route_from_FBdataclient2_nameRoute = dataclient2_from_FB["Route"];

        const ToDoList = [];
        if ( info.route_id_odoo != route_from_FBdataclient2_idRoute) ToDoList.push("route changed");
        if ( info.stop_id_odoo != stop_from_FBdataclient2_idStop) ToDoList.push("stop changed");
        if ( info.stop_id_odoo != 0 && !info.route_id_odoo) ToDoList.push("There is stop but  no route");
        functions.logger.warn( "[odooToFirebase_Users] Tasks: ", {
          "odoo_session": odoo_session,
          "user_id_odoo": user_id,
          "to-do-list": ToDoList,
        });

        // --------------------------------------------------------------------------------------------------------
        // 1. if there is routes changes


        if ( info.route_id_odoo != route_from_FBdataclient2_idRoute || info.stop_id_odoo != stop_from_FBdataclient2_idStop || (info.stop_id_odoo != 0 && !info.route_id_odoo) ) {
          // First, delete the route from the categories array
          const index_category = user_categories.indexOf(info.route_id_odoo);
          if (index_category != -1 ) user_categories.splice( index_category, 1);


          if (info.stop_id_odoo == 0) { // if there is no stop in odoo then there is no route either
            info.route_id_odoo = 0;
            info.route_name = "NaN";
          } else {
            // search route in firebase for that stop
            for (let index = 0, len = fb_stops.length; index < len; index++) { // obtain stop_id_firebase
              // console.log("fb_stops[Number(keys[index])].idOdoo ", fb_stops[Number(keys[index])].idOdoo )
              // console.log("info.stop_id_odoo " , info.stop_id_odoo)
              if ( fb_stops[Number(keys[index])].idOdoo == info.stop_id_odoo) {
                info.stop_id_firebase = Number(keys[index]);
                break;
              }
            }

            let related_route_from_Odoo = await FirebaseFcn.firebaseGet("stops/" + info.stop_id_firebase +"/Route_idOdoo/" );// obtain the route from stops in firebase

            if (related_route_from_Odoo == null ) { // if there is no route idOdoo find it in usinfg Nom_ruta and update the Route_idOdoo
              const related_route = await FirebaseFcn.firebaseGet("stops/" + info.stop_id_firebase +"/Nom_ruta/" );
              const raw = JSON.stringify({
                "params": {
                  "model": "res.partner.category",
                  "fields": ["id", "name"],
                  "offset": 0,
                  "domain": [["name", "like", related_route]],
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
                related_route_from_Odoo = data.result.records[0].id;
                info.route_id_odoo = related_route_from_Odoo;
                info.route_name = data.result.records[0].name;

                user_categories.push(info.route_id_odoo);
              } catch (err) {
                functions.logger.error( "[odooToFirebase_Users] Error finding route idOdoo from Odoo using Firebase route relationship ("+ related_route +"): " + err, info);
              }
            }
          }
          try {
            console.log("user_categories ", user_categories);

            const raw = JSON.stringify({
              "params": {
                "model": "res.partner",
                "method": "write",
                "kwargs": {},
                "args": [info.user_id_odoo,
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
            functions.logger.info( "[odooToFirebase_Users] updating route in Odoo without problem using Firebase stops relationship.", info);
          } catch (err) {
            functions.logger.error( "[odooToFirebase_Users] updating route in Odoo: " + err, info);
          }
        }


        // ---------------------------------------------------------------------------------------------------------------
        // 2. update stops in firebase if needed. first get the id stop if is attempting to delete it. compare with firebase to know what to do


        if ( info.stop_id_odoo != stop_from_FBdataclient2_idStop ) {
          if ( user_stop_data.result.length > 0) {
            try {
              for (let index = 0, len = fb_stops.length; index < len; index++) {
                if ( fb_stops[Number(keys[index])].idOdoo == user_stopId) {
                  info.stop_id_firebase = Number(keys[index]); //
                  const fb_addr = "stops/" + info.stop_id_firebase + "/partnersId/" + user_id;
                  const res = await FirebaseFcn.firebaseSet(fb_addr, true);
                  if (res) functions.logger.info( "[odooToFirebase_Users] updating stop node in Fb without problems ("+fb_addr+") ", info);
                  else functions.logger.error( "[odooToFirebase_Users] Error updating stop node in Fb ("+fb_addr+"): " + res, info );

                  break;
                } else {
                  if (index == len - 1) console.log("create stop in fb ", index + 1); // TODOOOOOOOOOOO
                }
              }
            } catch (err) {
              functions.logger.error( "[odooToFirebase_Users] Error updating stop: " + err, {
                "odoo_session": odoo_session,
                "user_id": user_id} );
            }
          } else {
            // get the stop from "/Data_client_2/" is there is any
            // console.log("stop_from_FBdataclient2 ", JSON.stringify(stop_from_FBdataclient2))
            // console.log("stop_from_FBdataclient2_idStop ", stop_from_FBdataclient2_idStop);
            // console.log("stop_from_FBdataclient2_Stops ", stop_from_FBdataclient2_nameStop);


            if (stop_from_FBdataclient2_nameStop == "NaN") continue; // because there is no stop in Fb (before) and no stop from Odoo (after).
            else { // an stop was deleted in Odoo
              let idStop_fromFB;
              if (stop_from_FBdataclient2_idStop == undefined) {
                const raw = JSON.stringify({
                  "params": {
                    "model": "res.partner.category",
                    "fields": ["id", "name", "partner_ids"],
                    "offset": 0,
                    "domain": [["name", "like", stop_from_FBdataclient2_nameStop]],
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
                  idStop_fromFB = data.result.records[0].id;
                } catch (err) {
                  functions.logger.error( "[odooToFirebase_Users] Error finding stop id from Odoo: " + err, {
                    "odoo_session": odoo_session,
                    "user_id": user_id} );
                }
              } else {
                idStop_fromFB = stop_from_FBdataclient2_idStop;
              }


              for (let index = 0, len = fb_stops.length; index < len; index++) {
                if ( fb_stops[Number(keys[index])].idOdoo == idStop_fromFB) {
                  info.stop_id_firebase = Number(keys[index]);
                  const fb_addr ="stops/" + info.stop_id_firebase + "/partnersId/"+user_id +"/";
                  const res = await FirebaseFcn.firebaseRemove(fb_addr);
                  if (res) {
                    functions.logger.info( "[odooToFirebase_Users] deleting stop node ("+fb_addr+") in Fb without problems. ", info);
                  } else {
                    functions.logger.error( "[odooToFirebase_Users] Error deleting stop node ("+fb_addr+") in Fb: " + res, {
                      "odoo_session": odoo_session,
                      "user_id": user_id} );
                  }


                  break;
                } else {
                  if (index == len - 1) console.log("Nothing to do. there is no stop");
                }
              }
            }
          }


          // 3. Data client 2 ------------------------------------------------------------------------------------------------------------------------------
          // below is a json for fb CHECK THIS!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
          const data_client2_json = {
            "idStop": user_stopId,
            "Stops": user_namestop,
            "idRoute": user_routeId,
            "Route": user_nameroute,

          };

          const fb_addr = "Data_client/" + user_id +"/Data_client_2/";
          try {
            const res = await FirebaseFcn.firebaseUpdate(fb_addr, data_client2_json );
            if (res == true) functions.logger.info( "[odooToFirebase_Users] updating user in Firebase ("+ fb_addr +") from Odoo. ", info );
            else {
              functions.logger.error( "[odooToFirebase_Users] Error updating user ("+ fb_addr+ "): " + res, {
                "odoo_session": odoo_session,
                "user_id": user_id});
            }
          } catch (err) {
            functions.logger.error( "[odooToFirebase_Users] Error updating user ("+ fb_addr +"): " + err, {
              "odoo_session": odoo_session,
              "user_id": user_id} );
          }
        }
      }
    } else functions.logger.info( "[odooToFirebase_Users] No update founded in Odoo.", {"odoo_session": odoo_session});

    const dateTime = Date.now();
    FirebaseFcn.firebaseSet("/timestamp_collection/ussersTimeStamp", String(dateTime));
    functions.logger.info( "[odooToFirebase_Users] updating ussersTimeStamp in Firebase", {
      "odoo_session": odoo_session,
      "userTimestamp": String(dateTime),
    } );
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
  //console.log("category_ids", category_ids);

  const new_category_ids: Array<number> = category_ids.filter((id) => (id != idOdoo));
  //console.log("new_category_ids", new_category_ids);

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
  //console.log("data_write", data_write);

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
  //console.log("dataaa", data);

  return idOdoo;
}

async function checkingCategoriesOdoo(CustomHeaders:any, user_categories: any, mode:string) {
  try {
    const raw = JSON.stringify({
      "params": {
        "model": "res.partner.category",
        "fields": ["id", "name"],
        "offset": 0,
        "domain": ["&", ["id", "in", user_categories], ["name", "ilike", mode]],
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
  const date = new Date(Number(lastupdateTimestamp)-5000);
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

  return (len <= 0);
}
