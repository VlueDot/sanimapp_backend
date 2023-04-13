

const odoo_db = "oxe360-ooc-sanisol-staging-13-0-7921785";
export const odoo_url = "https://"+ odoo_db +".dev.odoo.com/web/";

export const odoo_access = {
  headers: {"Content-Type": "application/json"},
  method: "post",
  body: JSON.stringify(

      {
        "params": {
          "db": odoo_db,
          "login": "pablo@sanima.pe",
          "password": "Sanima2021",
        }})};
