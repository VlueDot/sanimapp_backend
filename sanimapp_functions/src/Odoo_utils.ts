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
        "vat", "street", "display_name", "category_id", "l10n_pe_ubigeo"],
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

          // ROUTES ----------------------------------------------------------------

          const user_route_data = await checkingCategoriesOdoo( CustomHeaders, user_categories, "ruta" );
          let user_routeId = 0; let user_nameroute = "NaN";
          

          if (user_route_data.result.length > 0) {
            user_routeId = user_route_data.result.records[0].id;
            user_nameroute = user_route_data.result.records[0].name;
          }

          const initialOdoo_routeId = user_routeId


          // ESTADO ----------------------------------------------------------------

          const user_status_data = await checkingCategoriesOdoo( CustomHeaders, user_categories, "estado" );
          let user_status_name ="Cliente con firma"
          if (user_route_data.result.length > 0) {
            user_status_name = user_status_data.result.records[0].name;
          }



          //------------------------------ GET FROM FIREBASE
          let stop_id_odoo_fromDataClient2 = 0
          let stop_id_firebase = 0
          let stop_name_fromDataClient2 = "NaN"
          
          let route_id_odoo_fromDataClient2 = 0
          let route_id_firebase = 0
          let route_name_fromDataClient2 = "NaN "

          try {
            const dataclient2_from_FB = await FirebaseFcn.firebaseGet("Data_client/" + user_id +"/Data_client_2/" );
            stop_id_odoo_fromDataClient2 = dataclient2_from_FB["idStop"];
            stop_id_firebase = dataclient2_from_FB["stop_id_firebase"];
            stop_name_fromDataClient2 = dataclient2_from_FB["Stops"];
            
            route_id_odoo_fromDataClient2 = dataclient2_from_FB["idRoute"];
            route_id_firebase = dataclient2_from_FB["route_id_firebase"];
            route_name_fromDataClient2 = dataclient2_from_FB["Route"];

            if(dataclient2_from_FB["Stops"] == "NaN"){
              stop_id_odoo_fromDataClient2 = 0
              stop_id_firebase = 0
              stop_name_fromDataClient2 = "NaN"
              
              route_id_odoo_fromDataClient2 = 0
              route_id_firebase = 0
              route_name_fromDataClient2 = "NaN "

            } else{


              if(!dataclient2_from_FB["idStop"] || !dataclient2_from_FB["idRoute"] || !dataclient2_from_FB["stop_id_firebase"] || !dataclient2_from_FB["route_id_firebase"]) {
                for (let index = 0, len = fb_stops.length; index < len; index++) { 
                  if ( fb_stops[Number(keys[index])].Stops_name == dataclient2_from_FB.Stops) {
                    stop_id_odoo_fromDataClient2 = fb_stops[Number(keys[index])].idOdoo
                    stop_id_firebase = Number(keys[index]);
                    route_name_fromDataClient2 = fb_stops[Number(keys[index])].Nom_ruta
                    break;
                  }
                }

                for (let index = 0, len = fb_routes.length; index < len; index++) { 
                  if ( fb_routes[Number(keys_routes[index])].Nom_ruta == route_name_fromDataClient2) {
                    route_id_odoo_fromDataClient2 = fb_routes[Number(keys_routes[index])].idOdoo
                    route_id_firebase = Number(keys_routes[index])
                    

                    break;
                  }
                }
              }
            }
          } catch (error) {

            const dataClient_node = {
              "Data_client_1": {
                "Addr_reference": "NaN",
                "Address": target_data[i].street,
                "Birth_date": "000000", //Created in app
                "Campaign_month": "NaN", //Created in app
                "Client_Community": "NaN",
                "Country": "Perú",
                "DNI": target_data[i].vat,
                "How_know_us": "NaN", //Created in app
                "How_know_us_method": "NaN", //Created in Odoo
                "How_know_us_referals": "NaN",
                "Last_name_1": target_data[i].surname,
                "Last_name_2": target_data[i].mother_name,
                "Lost_client_reason": "NaN",
                "Name_1": target_data[i].first_name,
                "Name_2": target_data[i].middle_name,
                "Name_potencial": "NaN",
                "Phone1": target_data[i].phone,
                "Phone2": target_data[i].mobile,
                "Sales_person": "NaN",
                "Sales_person_Commit": "NaN",
                "Urine_preference": "NaN",
                "Zone": "NaN",
                "ubigeo": target_data[i].l10n_pe_ubigeo
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
                "stop_id_firebase": 0
              },
              "Data_client_3": {
                "Addr": target_data[i].street,
                "Addr_reference": "NaN",
                "Name_complete": target_data[i].display_name,
                "Phone1": target_data[i].phone,
                "Phone2": target_data[i].mobile,
                "client_coment_OPE": "NaN",
                "client_type": user_status_name
              }
            }

            functions.logger.info( "[odooToFirebase_Users] There is no user in Firebase. Creating user in Data_client/" + user_id, {
              "odoo_session": odoo_session,
              "user_id_odoo": user_id,
            });
            FirebaseFcn.firebaseSet("Data_client/" + user_id, dataClient_node)          
          }
          

          //-----------------------------------------------------------------------------------------
          //Complete Data Client 2. Even if you are gonna write it. 
          

          
          
          const initialState  = {
            //State From Firebase
            "stop_id_odoo": stop_id_odoo_fromDataClient2,
            "stop_id_firebase": stop_id_firebase,
            "stop_name": stop_name_fromDataClient2,
            "route_id_odoo": route_id_odoo_fromDataClient2,
            "route_id_firebase": route_id_firebase,
            "route_name": route_name_fromDataClient2,

          }

          //update firebase

          let target_stopId_fb = 0
          let target_routeId_fb = 0

          if(user_stopId != 0){
            for (let index = 0, len = fb_stops.length; index < len; index++) { 
              if ( fb_stops[Number(keys[index])].idOdoo == user_stopId) {
                target_stopId_fb = Number(keys[index]);
                user_nameroute = fb_stops[Number(keys[index])].Nom_ruta
                break;
              }
            }

            for (let index = 0, len = fb_routes.length; index < len; index++) { 
              if ( fb_routes[Number(keys_routes[index])].Nom_ruta == user_nameroute) {          
                target_routeId_fb = Number(keys_routes[index]);
                user_routeId = Number( fb_routes[Number(keys_routes[index])].idOdoo)
                break;
              }
            }

          }

          const targetState  = {
            //State From Odoo
            "stop_id_odoo": user_stopId,
            "stop_id_firebase": target_stopId_fb,
            "stop_name": user_namestop,
            "route_id_odoo": user_routeId,
            "route_id_firebase": target_routeId_fb,
            "route_name": user_nameroute,

          }

          const ToDoList = [];
          const stops_changed =  initialState.stop_id_odoo != targetState.stop_id_odoo
          const just_routes_changed =  initialState.route_id_odoo != targetState.route_id_odoo && !stops_changed  
          const just_no_route = targetState.route_id_odoo == 0 &&  targetState.stop_id_odoo != 0  &&  !stops_changed 
          if (stops_changed) ToDoList.push("Stops changed: " + initialState.stop_id_odoo +" -> " + targetState.stop_id_odoo);
          if ( just_routes_changed) ToDoList.push("Routes changed: " + initialState.route_id_odoo +" -> " + targetState.route_id_odoo);
          if ( just_no_route ) ToDoList.push("There is no route in odoo")
          if (!stops_changed && !just_no_route && ! just_routes_changed) ToDoList.push("Nothing to do.")
               
         

          functions.logger.info( "[odooToFirebase_Users] Tasks. ", 
          {
            "odoo_session": odoo_session,
            "user_id_odoo": user_id,
            "to-do-list": ToDoList,
            "initialState" : initialState,
            "targetState": targetState ,
            
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
          }       

          if ( stops_changed){ 
            //1 update route in odoo
            //2 update data client 2
            //3 update route colection , delete user from initial route and add it in target route
            //4 update route definitions , delete user from initial route and add it in target route
            //5 update stops  , delete user from initial stop and add it in

            //-----------------------------(1)-----------------------------------
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

            //-----------------------------(2)-----------------------------------
            //2 update data client 2
            const dataclient2_address = "Data_client/" + user_id +"/Data_client_2/";
            const data_client2_json = {
              "idStop": targetState.stop_id_odoo,
              "Stops": targetState.stop_name,
              "idRoute": targetState.route_id_odoo,
              "Route": targetState.route_name,
              "route_id_firebase": targetState.route_id_firebase,
              "stop_id_firebase": targetState.stop_id_firebase
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

            //-----------------------------(3)-----------------------------------
            //3 update route colection , delete user from initial route and add it in target route
            const routesCollection_address = "Routes_collection/" + targetState.route_id_firebase+ "/"+ targetState.stop_id_firebase +"/"+ user_id ;
            const routes_collection_json = {
              "Just_complete_name" : target_data[i].display_name ,
              "client_coment_OPE": "NaN"
            }  

            //Adding
            try {
              const res = await FirebaseFcn.firebaseUpdate(routesCollection_address, routes_collection_json );
              if (res == true) functions.logger.info( "[odooToFirebase_Users] updating user in Routes_collection ("+ routesCollection_address +") from Odoo. ", info );
              else {
                functions.logger.error( "[odooToFirebase_Users] Error updating user in Routes_collection ("+ routesCollection_address+ "): " + res, {
                  "odoo_session": odoo_session,
                  "user_id": user_id});
              }
              
            } catch (err) {
              functions.logger.error( "[odooToFirebase_Users] Error updating Routes_collection in Firebase: ("+ dataclient2_address +"): " + err, {
                "odoo_session": odoo_session,
                "user_id": user_id} );
            }
            //deleting
            const routesCollection_address_delete = "Routes_collection/" + initialState.route_id_firebase+ "/"+ initialState.stop_id_firebase +"/"+ user_id ;
            try {
              const res = await FirebaseFcn.firebaseRemove(routesCollection_address_delete);
              if (res == true) functions.logger.info( "[odooToFirebase_Users] deleting initial stop in Routes_collection ("+ routesCollection_address_delete +") from Odoo. ", info );
              else {
                functions.logger.error( "[odooToFirebase_Users] Error deleting initial stop in Routes_collection ("+ routesCollection_address_delete+ "): " + res, {
                  "odoo_session": odoo_session,
                  "user_id": user_id});
              }
              
            } catch (err) {
              functions.logger.error( "[odooToFirebase_Users] Error deleting initial stop in Routes_collection ("+ routesCollection_address_delete +"): " + err, {
                "odoo_session": odoo_session,
                "user_id": user_id} );
            }

            //-----------------------------(4)-----------------------------------
            //4 update route definitions , delete user from initial route and add it in target route
            //se supone que si el paradero ha sido modificado de ruta, esto ya esta en el nodo de route definition. 

            const routesDefinition_address = +"Route_definition/" + targetState.route_id_firebase+"/partnersId/"  ;
           
            //deleting
            const routesDefinition_address_delete = "Route_definition/" + initialState.route_id_firebase+ "/partnersId/"+ user_id ;
            try {
              const res = await FirebaseFcn.firebaseRemove(routesDefinition_address_delete);
              if (res == true) functions.logger.info( "[odooToFirebase_Users] deleting user in initial stop in Route_definition ("+ routesDefinition_address_delete +") from Odoo. ", info );
              else {
                functions.logger.error( "[odooToFirebase_Users] Error deleting user in initial stop in Route_definition ("+ routesDefinition_address_delete+ "): " + res, {
                  "odoo_session": odoo_session,
                  "user_id": user_id});
              }
              
            } catch (err) {
              functions.logger.error( "[odooToFirebase_Users] Error deleting user in initial stop in Route_definition ("+ routesDefinition_address_delete +"): " + err, {
                "odoo_session": odoo_session,
                "user_id": user_id} );
       
              }

            //Adding
            try {
              
              const map = new Map();
              map.set(user_id,true);
              const firebase_json = Object.fromEntries(map);
              const res = await FirebaseFcn.firebaseUpdate(routesDefinition_address, firebase_json );
              if (res == true) functions.logger.info( "[odooToFirebase_Users] updating user "+ user_id+" in Route_definition ("+ routesDefinition_address +") from Odoo. ", info );
              else {
                functions.logger.error( "[odooToFirebase_Users] Error updating user "+ user_id+" in Route_definition ("+ routesDefinition_address+ "): " + res, {
                  "odoo_session": odoo_session,
                  "user_id": user_id});
              }
              
            } catch (err) {
              functions.logger.error( "[odooToFirebase_Users] Error updating user "+ user_id+"  in Route_definition in Firebase: ("+ routesDefinition_address +"): " + err, {
                "odoo_session": odoo_session,
                "user_id": user_id} );
            }

            //-----------------------------(5 )-----------------------------------
            //5 update stops  , delete user from initial stop and add it in
            //deleting
            const stops_address_delete = "stops/" + initialState.stop_id_firebase+ "/partnersId/"+ user_id ;
            try {
              const res = await FirebaseFcn.firebaseRemove(stops_address_delete);
              if (res == true) functions.logger.info( "[odooToFirebase_Users] deleting user "+ user_id+" in initial stop ("+ stops_address_delete +") from Odoo. ", info );
              else {
                functions.logger.error( "[odooToFirebase_Users] Error deleting user "+ user_id+" in initial stop ("+ routesDefinition_address_delete+ "): " + res, {
                  "odoo_session": odoo_session,
                  "user_id": user_id});
              }
              
            } catch (err) {
              functions.logger.error( "[odooToFirebase_Users] Error deleting user "+ user_id+" in initial stop  ("+ routesDefinition_address_delete +"): " + err, {
                "odoo_session": odoo_session,
                "user_id": user_id} );
       
              }

            //Adding
            const stops_address = +"stops/" + targetState.route_id_firebase+"/partnersId/"  ;
            try {
              
              const map = new Map();
              map.set(user_id,true);
              const firebase_json = Object.fromEntries(map);
              const res = await FirebaseFcn.firebaseUpdate(stops_address, firebase_json );
              if (res == true) functions.logger.info( "[odooToFirebase_Users] updating user "+ user_id+" in target stop in Firebase ("+ stops_address +") from Odoo. ", info );
              else {
                functions.logger.error( "[odooToFirebase_Users] Error updating user "+ user_id+" in target stop in Firebase ("+ stops_address+ "): " + res, {
                  "odoo_session": odoo_session,
                  "user_id": user_id});
              }
              
            } catch (err) {
              functions.logger.error( "[odooToFirebase_Users] Error updating user "+ user_id+"  in target stop in Firebase: ("+ stops_address +"): " + err, {
                "odoo_session": odoo_session,
                "user_id": user_id} );
            }

          }

          if(just_routes_changed ){
            console.log("just_routes_changed")
          }

          if(just_no_route ){
            console.log("just_no_route")
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
            "user_id" : user_id  
          } );
          FirebaseFcn.firebaseSet("/Backend/Errors/odooToFirebase_Users/"+user_id,{
            "odoo_session": odoo_session,
            "user_id" : user_id,
            "target_userCategories" :user_categories
          } )
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
  console.log("category_ids", category_ids);

  const new_category_ids: Array<number> = category_ids.filter((id) => (id != idOdoo));
  console.log("new_category_ids", new_category_ids);

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
  console.log("data_write", data_write);

  return null;
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
  console.log("dataaa", data);

  return idOdoo;
}

async function checkingCategoriesOdoo(CustomHeaders:any, user_categories: any, mode:string) {
  let criteria_array = []
if (mode == "estado") criteria_array = [ "name","in", ["usuario activo", "usuario inactivo", "Usuario por instalar"]]
else criteria_array = ["name", "ilike", mode]

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

export async function odooWriteInFirebase(odoo_session:any, idOdoo: number, lastupdateTimestamp: any) {
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

  return (len <= 0);
}
