import fetch from "node-fetch";
import * as settings from "./GlobalSetting";
import * as functions from "firebase-functions";
import * as FirebaseFcn from "./Firebase_utils";


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
      functions.logger.info("[odoo_Login] Odoo Authentication Succeeded.", {"odoo_session": odoo_session, "db": settings.odoo_db});
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

export async function odooToFirebase_Campaigns(odoo_session:any, lastupdateTimestamp: any) {
  const date = new Date(Number(lastupdateTimestamp));
  const date_str = "'"+ date.getFullYear()+"-"+("0" + (date.getMonth() + 1)).slice(-2)+"-"+("0" +date.getDate()).slice(-2)+" "+ ("0" +date.getHours()).slice(-2)+":"+("0" +date.getMinutes()).slice(-2)+":"+("0" +date.getSeconds()).slice(-2) + "'";

  // console.log(date_str);

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
  }

  let res = false;

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
  }

  try {
    if (res) {
      const dateTime = Date.now();
      FirebaseFcn.firebaseSet("/timestamp_collection/CMR_campaings_timestamp", String(dateTime));

      const new_date = new Date(Number(dateTime));
      const new_date_str = "'"+ new_date.getFullYear()+"-"+("0" + (new_date.getMonth() + 1)).slice(-2)+"-"+("0" +new_date.getDate()).slice(-2)+" "+ ("0" +new_date.getHours()).slice(-2)+":"+("0" +new_date.getMinutes()).slice(-2)+":"+("0" +new_date.getSeconds()).slice(-2) + "'";


      functions.logger.info( "[odooToFirebase_Users] Campaings succesful updated.", {
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
  }
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

export async function odooToFirebase_Users(odoo_session:any, lastupdateTimestamp:any) {

  let illegal_entries_stack 

  let warning_list = [];
  let warning_list_map = new Map();

  if (lastupdateTimestamp==null) lastupdateTimestamp = 0;
  const date = new Date(Number(lastupdateTimestamp));
  const date_str = "'"+ date.getFullYear()+"-"+("0" + (date.getMonth() + 1)).slice(-2)+"-"+("0" +date.getDate()).slice(-2)+" "+ ("0" +date.getHours()).slice(-2)+":"+("0" +date.getMinutes()).slice(-2)+":"+("0" +date.getSeconds()).slice(-2) + "'";
  console.log(date_str);
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
          "vat", "street", "street2", "city", "country_id", "display_name", "category_id", "write_date"],
        "domain": [["write_date", ">", date_str]],
      },
    });

    const params = {
      headers: CustomHeaders,
      method: "post",
      body: raw,
    };
    const response = await fetch(settings.odoo_url + "dataset/search_read/", params);
    const odoo_query_time = Date.now();    //THIS IS THE TIME WHERE I MADE THE CHECK
    let data;
    data = await response.json();

    const qtty_users = data.result.length;
    if (qtty_users > 0) {
      //donwload illegal_entries_stack
      let illegal_entries_stack_keys
      try {
        illegal_entries_stack = await FirebaseFcn.firebaseGet("illegal_entries_stack")
        illegal_entries_stack_keys = Object.keys(illegal_entries_stack);

        for(let index=0; index< illegal_entries_stack_keys.length; index ++) warning_list_map.set(illegal_entries_stack_keys[index], illegal_entries_stack[illegal_entries_stack_keys[index]])

      } catch (error) {
        console.log(error)
      }

      
      
      

      const fb_stops = await FirebaseFcn.firebaseGet("stops");
      const keys = Object.keys(fb_stops);

      const fb_routes = await FirebaseFcn.firebaseGet("Route_definition");
      const keys_routes = Object.keys(fb_routes);

      const target_data = data.result.records;
      functions.logger.info( "[odooToFirebase_Users] Entries Founded:  ",
          {"odoo_session": odoo_session,
            "target_data": target_data,
          } );


      let count_correct = 0;

      for (let i= 0; i<qtty_users; i++) {
        const user_id = target_data[i].id;
        const user_name = target_data[i].name;
        const user_categories = target_data[i].category_id;

        try {
          // check for categories
          // alternatively we could download every stops and categories. depending on demand or testings

          console.log( i+1, "/", qtty_users, "----------------------------------------------------");
          console.log(user_categories);
          let user_categories_filtered = await search_categories_Odoo( user_categories, categories_list );
          console.log("user_categories_filtered: ", user_categories_filtered);


          // STOPS ----------------------------------------------------------------
          const user_stop_data = user_categories_filtered.filter( (e:any) => e.name.includes("Paradero:"));
          // ROUTES ----------------------------------------------------------------
          const user_route_data = user_categories_filtered.filter( (e:any) => e.name.includes("Ruta:"));
          // ESTADO ----------------------------------------------------------------
          const user_status_data = user_categories_filtered.filter( (e:any) => e.name.includes("usuario activo") || e.name.includes("usuario inactivo") || e.name.includes("Usuario por instalar"));


          // console.log("user_stop_data: ", user_stop_data);
          // console.log("user_route_data: ", user_route_data);
          // console.log("user_status_data: ", user_status_data);

          // FILTERS DEFINE STATES
          let legal_task = true;
          let reason;
          let no_entry_in_firebase = false;
          let user_state_is_NaN  = false

          const usuario_inactivo_tags = ["Cliente desinstalado"]
          const usuario_activo_tags = ["Cliente Nuevo", "Cliente normal"]
          const usuario_instalar_tags = ["Cliente por instalar"]
          

          if (user_status_data.length == 1) {
            const user_state_from_firebase = await FirebaseFcn.firebaseGet("Data_client/" + user_id +"/Data_client_2/Client_Type" );
            const user_state2_from_firebase = await FirebaseFcn.firebaseGet("Data_client/" + user_id +"/Data_client_3/client_type" );

            console.log("user_state_from_firebase ", user_state_from_firebase);

            

            if (user_state2_from_firebase == null && user_state_from_firebase == null) no_entry_in_firebase = true;

            if (user_state2_from_firebase == "NaN" && user_state_from_firebase == "NaN") user_state_is_NaN = true;


            if (user_state2_from_firebase != user_state_from_firebase && !no_entry_in_firebase ) {
              legal_task = false;
              reason = "Different user states found in firebase. Fix it first. (" + user_state_from_firebase +", "+ user_state2_from_firebase+")";
              warning_list.push(user_name + " ("+ user_id +") " + reason);
              warning_list_map.set(user_id, "("+ user_name +") " + reason)

            } else {

              let user_state_from_firebase_Odoo_label
              if(usuario_instalar_tags.includes(user_state_from_firebase)) user_state_from_firebase_Odoo_label = "Usuario por instalar"
              if(usuario_activo_tags.includes(user_state_from_firebase)) user_state_from_firebase_Odoo_label = "usuario activo"
              if(usuario_inactivo_tags.includes(user_state_from_firebase)) user_state_from_firebase_Odoo_label = "usuario inactivo"




              if ( user_status_data[0].name == "Usuario por instalar" ) {
                if ( no_entry_in_firebase || user_state_from_firebase_Odoo_label == "Usuario por instalar" || user_state_is_NaN || user_state_from_firebase_Odoo_label =="usuario inactivo") {
                  true;
                } else {
                  legal_task = false;
                  reason = "Forbidden move 1. From Firebase " + user_state_from_firebase_Odoo_label +  " ("+ user_state_from_firebase +") ---> 'Usuario por instalar' " ;
                  warning_list.push(user_name + " ("+ user_id +") " + reason);
                  warning_list_map.set(user_id, "("+ user_name +") " + reason)
                }
              }



              if ( user_status_data[0].name == "usuario activo" ) {
                if (user_state_from_firebase_Odoo_label == "Usuario por instalar"  ||  user_state_from_firebase_Odoo_label == "usuario activo"   ) {
                  if (user_stop_data.length == 0) {
                    legal_task = false;
                    reason = "Forbidden move 2. Impossible to set Usuario activo without stop";
                    warning_list.push(user_name + " ("+ user_id +") " + reason);
                    warning_list_map.set(user_id, "("+ user_name +") " + reason)
                  } else if (user_stop_data.length > 1) {
                    legal_task = false;
                    reason = "Forbidden move 3. Impossible to set Usuario activo with more than 1 stop " + user_stop_data;
                    warning_list.push(user_name + " ("+ user_id +") " + reason);
                    warning_list_map.set(user_id, "("+ user_name +") " + reason)
                  }
                } else {
                  legal_task = false;
                  reason = "Forbidden move 4. From Firebase " + user_state_from_firebase_Odoo_label +  " ("+ user_state_from_firebase +") ---> 'usuario activo' " ;
                  warning_list.push(user_name + " ("+ user_id +") " + reason);
                  warning_list_map.set(user_id, "("+ user_name +") " + reason)
                }
              }

              if ( user_status_data[0].name == "usuario inactivo" ) {
                if (user_state_from_firebase_Odoo_label == "usuario activo" || user_state_from_firebase_Odoo_label == "usuario inactivo") {
                  true;
                } else {
                  legal_task = false;
                  reason = "Forbidden move 5. From Firebase " + user_state_from_firebase_Odoo_label +  " ("+ user_state_from_firebase +") ---> 'usuario inactivo' " ;
                  warning_list.push(user_name + " ("+ user_id +") " + reason);
                  warning_list_map.set(user_id, "("+ user_name +") " + reason)
                }
              }
            }
          } else {
            if (user_status_data.length == 0) reason = "There is no state for a client. Will be ignored.";
            else reason = "There are more than 1 one state for a client. Will be ignored.";
            warning_list.push( user_name + " ("+ user_id +") " + reason);
            warning_list_map.set(user_id, "("+ user_name +") " + reason)
            legal_task = false;
          }

          try {
            if (legal_task) {
              // STOPS ----------------------------------------------------------------

              let user_stopId = 0; let user_namestop = "NaN";

              if (user_stop_data.length > 0 && user_status_data[0].name == "usuario activo") {
                user_stopId = user_stop_data[0].id;
                user_namestop = user_stop_data[0].name;
              }

              // ROUTES ----------------------------------------------------------------
              let user_routeId = 0; let user_nameroute = "NaN";


              if (user_route_data.length > 0 && user_status_data[0].name == "usuario activo") {
                user_routeId = user_route_data[0].id;
                user_nameroute = user_route_data[0].name;
              }

              const initialOdoo_routeId = user_routeId;

              // ESTADO ----------------------------------------------------------------

              let user_status_name ="NaN"; // if NaN its error


              if (user_status_data.length > 0) {
                if ( user_status_data[0].name == "Usuario por instalar") user_status_name = "Cliente por instalar";
                else if ( user_status_data[0].name == "usuario inactivo") user_status_name = "Cliente desinstalado";
                else if ( user_status_data[0].name == "usuario activo" && user_route_data.length == 1) user_status_name = "Cliente normal";
              }

              console.log("user_status_name ", user_status_name)

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

              console.log("$$ mark 1");

              // ------------------------------ GET FROM FIREBASE

              let stop_id_odoo_fromDataClient2 = 0;
              let stop_id_firebase = 0;
              let stop_name_fromDataClient2 = "NaN";

              let route_id_odoo_fromDataClient2 = 0;
              let route_id_firebase = 0;
              let route_name_fromDataClient2 = "NaN ";

              let client_type_fromDataCLient2 = "NaN"

              try {
                const dataclient2_from_FB = await FirebaseFcn.firebaseGet("Data_client/" + user_id +"/Data_client_2/" );
                stop_id_odoo_fromDataClient2 = dataclient2_from_FB["idStop"];
                stop_id_firebase = dataclient2_from_FB["stop_id_firebase"];
                stop_name_fromDataClient2 = dataclient2_from_FB["Stops"];

                route_id_odoo_fromDataClient2 = dataclient2_from_FB["idRoute"];
                route_id_firebase = dataclient2_from_FB["route_id_firebase"];
                route_name_fromDataClient2 = dataclient2_from_FB["Route"];

                client_type_fromDataCLient2 = dataclient2_from_FB["Client_Type"]

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
                "Client_Type": client_type_fromDataCLient2
                

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
                "Client_Type": user_status_name


              };


              const ToDoList = [];
              const stops_changed = initialState.stop_id_odoo != targetState.stop_id_odoo;
              const just_routes_changed = initialOdoo_routeId != targetState.route_id_odoo && !stops_changed;
              const just_no_route = targetState.route_id_odoo == 0 && targetState.stop_id_odoo != 0 && !stops_changed;
              const state_change = targetState.Client_Type != initialState.Client_Type;
              if (stops_changed) ToDoList.push("Stops changed: " + initialState.stop_id_odoo +" -> " + targetState.stop_id_odoo);
              if ( just_routes_changed) ToDoList.push("Routes changed: " + initialOdoo_routeId +" -> " + targetState.route_id_odoo);
              if ( just_no_route ) ToDoList.push("There is no route in odoo");
              if (!stops_changed && !just_no_route && ! just_routes_changed) ToDoList.push("Nothing to do.");


              // fast solution
              if(state_change){
                // update change in firebase
                try {
                  let status_address2 = "Data_client/" + user_id +"/Data_client_2/Client_Type";
                  let status_address3 = "Data_client/" + user_id +"/Data_client_3/client_type";

                  await FirebaseFcn.firebaseSet(status_address2, targetState.Client_Type );
                  await FirebaseFcn.firebaseSet(status_address3, targetState.Client_Type );

                  console.log("states updated")

                  
                } catch (error) {
                  console.log("states not updated. ", error)
                  
                }
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
                console.log("$$ mark 10");

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

              console.log("$$ mark 11-----------");
              
              if(warning_list_map.has(String(user_id))) {
                console.log("the user ", user_id, " is on the warning list. attempting to delete it")
                warning_list_map.delete(String(user_id))}
              
              count_correct = count_correct + 1;
            } else {
              functions.logger.info( "[odooToFirebase_Users] User " + user_id + " ignored due ilegal move.", {
                "odoo_session": odoo_session,
                "user_id": user_id,
                "warning_label": "illegal",
              });
            }
          } catch (error) {
            
          }
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


      
      FirebaseFcn.firebaseSet("/timestamp_collection/ussersTimeStamp", String(odoo_query_time));
      functions.logger.info( "[odooToFirebase_Users] updating ussersTimeStamp in Firebase", {
        "odoo_session": odoo_session,
        "userTimestamp": String(odoo_query_time),
      } );

      console.log("count_correct", count_correct);
      console.log("count_incorrect", warning_list.length);

      if (warning_list.length > 0) {
        const dateTimeEmail = Date.now();
        const subject_str = "Sanimapp Backend Alert"
        const welcome_str = "Esta es una alerta generada el "
        const message_str = "Se han ignorados los siguientes ingresos. Por favor, revisarlos a la brevedad."
        await FirebaseFcn.sendEmail(subject_str,welcome_str,dateTimeEmail, message_str, warning_list);
      }

      const warning_list_json = Object.fromEntries(warning_list_map);
      FirebaseFcn.firebaseSet("illegal_entries_stack",warning_list_json)

    } else functions.logger.info( "[odooToFirebase_Users] No update founded in Odoo.", {"odoo_session": odoo_session});
  } catch (err) {
    functions.logger.error( "[odooToFirebase_Users] ERROR: " + err, {"odoo_session": odoo_session} );
    return false;
  }

  return true;
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

// async function checkingCategoriesOdoo(CustomHeaders:any, user_categories: any, mode:string) {
//   let criteria_array = [];
//   if (mode == "estado") criteria_array = ["name", "in", ["usuario activo", "usuario inactivo", "Usuario por instalar"]];
//   else criteria_array = ["name", "ilike", mode];

//   try {
//     const raw = JSON.stringify({
//       "params": {
//         "model": "res.partner.category",
//         "fields": ["id", "name"],
//         "offset": 0,
//         "domain": ["&", ["id", "in", user_categories], criteria_array],
//       },
//     });

//     const params = {
//       headers: CustomHeaders,
//       method: "post",
//       body: raw,
//     };

//     const response = await fetch(settings.odoo_url + "dataset/search_read/", params);
//     const res = await response.json();
//     // console.log("response.json();", JSON.stringify(res))
//     return res;
//   } catch (err) {
//     functions.logger.error( "[CheckingCategoriesOdoo] ERROR. ", {"error": err, "user_categories": user_categories});
//     return {"result": {"records": []}};
//   }
// }

export async function search_categories_Odoo(user_categories: any, categories_list: any) {
  let filtered_element;
  let filtered_list = [];
  for (let each_id= 0; each_id < user_categories.length; each_id++) {
    try {
      filtered_element = categories_list.filter((e:any) => e.id == Number(user_categories[each_id]));
      // console.log("filtered_element", filtered_element);
      filtered_list.push(filtered_element[0]);
    } catch (error) {
      console.log("[search_categories_Odoo] error ", error);
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
            const targetState = initialState;

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
        "name", "phone", "mobile", "tag_ids", "user_id", "create_date", "write_date",
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

        let sales_person_name = "NaN";
        if (ticket["user_id"][1] != undefined) sales_person_name = ticket["user_id"][1];

        const create_date = Date.parse(ticket["create_date"]);

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
          sales_person_name = notRegisteredUsers[ticket_id]["Sales_person"];
          const potentialAddress = "/notRegisteredUsers/" + ticket_id;
          const initialState = await FirebaseFcn.firebaseGet(potentialAddress);
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
              targetState["Sales_person"] = sales_person_name;
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
                "Sales_person": sales_person_name,
                "Zone": ticket_type,
                "timeStampCreate": String(create_date), // line 1510
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

export async function odooToFirebase_all(odoo_session:any, lastupdateTimestamp_users: any,
    lastupdateTimestamp_tickets: any, lastupdateTimestamp_crm: any, lastupdateTimestamp_campaigns : any) {
  await odooToFirebase_CRMTickets(odoo_session, lastupdateTimestamp_crm);
  await odooToFirebase_Users(odoo_session, lastupdateTimestamp_users);
  await odooToFirebase_ServiceTickets(odoo_session, lastupdateTimestamp_tickets);
  await odooToFirebase_Campaigns(odoo_session, lastupdateTimestamp_campaigns);
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
  const itemsCollection = {
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
  };
  const InventoryCollection = new Map<string, number>(Object.entries(itemsCollection));

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
        const keys = Object.keys(listOfInv);
        for (let i = 0; i< keys.length; i++) {
          const key = String(keys[i]);
          if (InventoryCollection.get(key)!= null) {
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
    const idOdoo = String(data["result"]);

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
      return true;
    }
  } catch (err) {
    functions.logger.error("[odooToFirebase_CRMTickets] ERROR: " + err, {"odoo_session": odoo_session} );
    return true
    ;
  }

  return true;
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
    functions.logger.info("[firebaseToOdoo_updateCRM] ERROR updated CRM in Odoo ("+partner_id+")", {
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
