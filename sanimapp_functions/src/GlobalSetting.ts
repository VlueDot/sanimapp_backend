

export const odoo_url = "https://oxe360-ooc-sanisol-staging-13-0-7056032.dev.odoo.com/web/";

export const odoo_access = {
  headers: {"Content-Type": "application/json"},
  method: "post",
  body: JSON.stringify(

      {
        "params": {
          "db": "oxe360-ooc-sanisol-staging-13-0-7056032",
          "login": "pablo@sanima.pe",
          "password": "Sanima2021",
        }})};
