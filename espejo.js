/* Modo espejo (05-11-2026). Usuario: "en la web tiene que estar la base, no para modificarla, pero si para poder
   visualizarla... como una especie de modo espejo... si lo quiero ver desde un telefono... no necesito que se
   modifique nada".

   La web SOLO DIBUJA el archivo espejo.json que deja el programa de escritorio en la carpeta de OneDrive
   (FamilyExpensesSync) -- todo viene ya calculado alla (Inicio, cada estado de cuenta con su cuenta del total, el
   checklist), asi los numeros son siempre los del escritorio. Nunca escribe nada en la carpeta ni en la base.

   De donde lee (en orden):
     1. Tu cuenta Microsoft (OneDrive en linea): sirve en el telefono. Ver ESPEJO_MS_CLIENT_ID mas abajo.
     2. La carpeta de OneDrive del computador (Chrome/Edge), la misma que ya usaba la sincronizacion.
     3. La ultima copia que se vio en este navegador (por si no hay conexion).
   El contrato de espejo.json esta documentado en family_expenses/app/sync/espejo.py (escritorio). */
(function(){
  "use strict";

  var CLAVE_MODO_COMPLETO = "gf_modo_completo";      // "1" = la version completa de antes (emergencias)
  var IDB_NAME = "family_expenses_store", IDB_STORE = "kv";
  var CLAVE_CACHE = "espejo_cache", CLAVE_HANDLE = "sync_dir_handle";
  var MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre",
               "Noviembre", "Diciembre"];

  var datos = null, fuente = "", vista = "inicio";
  var sel = {persona: "", clave: "", personaCk: "", claveCk: ""};

  // ------------------------------------------------------------ utilidades
  function pesos(n){
    n = Math.round(Number(n) || 0);
    return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("es-CL");
  }
  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return {"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"}[c];
    });
  }
  function fechaCorta(iso){
    if(!iso) return "";
    var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
    if(!m) return String(iso);
    return m[3] + "-" + m[2] + (m[4] ? " " + m[4] + ":" + m[5] : "-" + m[1]);
  }
  function el(id){ return document.getElementById(id); }

  function idb(){
    return new Promise(function(ok, mal){
      if(!window.indexedDB){ mal(new Error("sin IndexedDB")); return; }
      var r = indexedDB.open(IDB_NAME);
      r.onupgradeneeded = function(){ if(!r.result.objectStoreNames.contains(IDB_STORE)) r.result.createObjectStore(IDB_STORE); };
      r.onsuccess = function(){ ok(r.result); };
      r.onerror = function(){ mal(r.error); };
    });
  }
  function idbGet(k){
    return idb().then(function(c){
      if(!c.objectStoreNames.contains(IDB_STORE)) return null;
      return new Promise(function(ok){
        var q = c.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(k);
        q.onsuccess = function(){ ok(q.result || null); };
        q.onerror = function(){ ok(null); };
      });
    }).catch(function(){ return null; });
  }
  function idbSet(k, v){
    return idb().then(function(c){
      return new Promise(function(ok){
        var tx = c.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(v, k);
        tx.oncomplete = function(){ ok(); };
        tx.onerror = function(){ ok(); };
      });
    }).catch(function(){});
  }

  // ------------------------------------------------------------ fuentes
  function leerDeCarpeta(pedirPermiso){
    if(typeof window.showDirectoryPicker !== "function") return Promise.resolve(null);
    return idbGet(CLAVE_HANDLE).then(function(handle){
      if(!handle){
        if(!pedirPermiso) return null;
        return window.showDirectoryPicker({mode: "read"}).then(function(h){ idbSet(CLAVE_HANDLE, h); return h; });
      }
      return handle.queryPermission({mode: "read"}).then(function(p){
        if(p === "granted") return handle;
        if(!pedirPermiso) return null;
        return handle.requestPermission({mode: "read"}).then(function(r){ return r === "granted" ? handle : null; });
      });
    }).then(function(handle){
      if(!handle) return null;
      return handle.getFileHandle("espejo.json").then(function(f){ return f.getFile(); })
        .then(function(f){ return f.text(); }).then(function(t){ return JSON.parse(t); })
        .catch(function(e){ if(e && e.name === "NotFoundError") return null; throw e; });
    });
  }

  function cargar(pedirPermiso){
    estado("Buscando los datos…", "");
    var intento = (window.GFEspejoMicrosoft && window.GFEspejoMicrosoft.leer)
      ? window.GFEspejoMicrosoft.leer(pedirPermiso).then(function(d){ if(d){ fuente = "OneDrive (cuenta Microsoft)"; } return d; })
      : Promise.resolve(null);
    return intento.catch(function(){ return null; }).then(function(d){
      if(d) return d;
      return leerDeCarpeta(pedirPermiso).then(function(d2){ if(d2) fuente = "carpeta de OneDrive de este computador"; return d2; })
        .catch(function(){ return null; });
    }).then(function(d){
      if(d){ idbSet(CLAVE_CACHE, d); return d; }
      return idbGet(CLAVE_CACHE).then(function(c){ if(c) fuente = "la última copia vista en este navegador"; return c; });
    }).then(function(d){
      if(!d){
        estado("Todavía no hay datos para mostrar.", "warn");
        dibujarSinDatos();
        return;
      }
      usar(d);
    });
  }

  function usar(d){
    datos = d;
    var personas = d.personas || [];
    var ultimo = (d.inicio && d.inicio.ultimo) || null;
    if(!sel.persona || personas.indexOf(sel.persona) < 0) sel.persona = personas[0] || "";
    if(!sel.personaCk || personas.indexOf(sel.personaCk) < 0) sel.personaCk = personas.indexOf("Alejandro") >= 0 ? "Alejandro" : sel.persona;
    if(ultimo && !sel.clave) sel.clave = ultimo[0] + "|" + ultimo[1];
    if(ultimo && !sel.claveCk) sel.claveCk = ultimo[0] + "|" + ultimo[1];
    estado("Datos del escritorio «" + (d.equipo || "?") + "», guardados el " + fechaCorta(d.generado_en) +
           " · leídos desde " + fuente + ".", "ok");
    dibujar();
  }

  // ------------------------------------------------------------ armado de la pagina
  function montar(){
    if(el("espejo")) return;
    var css = document.createElement("style");
    css.textContent =
      "body.modo-espejo > header, body.modo-espejo > main, body.modo-espejo > footer, body.modo-espejo #recordatorioPago{display:none !important;}" +
      "#espejo{max-width:1100px;margin:0 auto;padding:12px 16px 40px;}" +
      "#espejo .esp-top{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;}" +
      "#espejo h1{font-size:1.25rem;margin:4px 0;}" +
      "#espejo .esp-sub{color:var(--text-dim);font-size:.85rem;}" +
      "#espejo .esp-estado{font-size:.85rem;margin:6px 0 10px;}" +
      "#espejo .esp-estado.ok{color:var(--ok);} #espejo .esp-estado.warn{color:var(--warn);}" +
      "#espejo .esp-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 12px;}" +
      "#espejo .esp-tabs button{padding:7px 14px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);color:var(--text);cursor:pointer;}" +
      "#espejo .esp-tabs button.on{background:var(--accent);color:var(--accent-ink);border-color:var(--accent);}" +
      "#espejo .esp-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:12px;}" +
      "#espejo .esp-card h2{font-size:1.05rem;margin:0 0 8px;}" +
      "#espejo table{width:100%;border-collapse:collapse;font-size:.9rem;}" +
      "#espejo th,#espejo td{padding:5px 6px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top;}" +
      "#espejo td.n,#espejo th.n{text-align:right;white-space:nowrap;}" +
      "#espejo .esp-meses{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;}" +
      "#espejo .esp-mes{border:2px solid var(--border);border-radius:8px;padding:6px 10px;}" +
      "#espejo .esp-mes b{display:block;} #espejo .esp-mes small{color:var(--text-dim);}" +
      "#espejo .ok{color:var(--ok);} #espejo .bad{color:var(--bad);} #espejo .warn{color:var(--warn);} #espejo .dim{color:var(--text-dim);}" +
      "#espejo .esp-filtros{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;}" +
      "#espejo select{padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface-2);color:var(--text);max-width:100%;}" +
      "#espejo .esp-veredicto{font-size:1.15rem;font-weight:700;margin:4px 0 8px;}" +
      "#espejo .esp-cuenta td{border:none;padding:2px 6px;} #espejo .esp-cuenta tr.tot td{border-top:2px solid var(--border);font-weight:700;}" +
      "#espejo .esp-btn{padding:6px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);color:var(--text);cursor:pointer;}" +
      "#espejo .esp-btn.pri{background:var(--accent);color:var(--accent-ink);border-color:var(--accent);}" +
      "#espejo .esp-pie{margin-top:18px;font-size:.8rem;color:var(--text-dim);}" +
      "#espejo .esp-pie a{color:var(--text-dim);}" +
      "@media (max-width:600px){#espejo{padding:8px 10px 30px;} #espejo th.opc,#espejo td.opc{display:none;}}";
    document.head.appendChild(css);
    var raiz = document.createElement("div");
    raiz.id = "espejo";
    raiz.innerHTML =
      "<div class=\"esp-top\"><div><h1>🏠 Gastos Familiares</h1>" +
      "<div class=\"esp-sub\">Modo espejo: aquí solo se mira. Todo se carga en los computadores.</div></div>" +
      "<div><button type=\"button\" class=\"esp-btn\" id=\"espActualizar\">↻ Actualizar</button> " +
      "<button type=\"button\" class=\"esp-btn\" id=\"espConectar\" hidden>Conectar…</button></div></div>" +
      "<div class=\"esp-estado\" id=\"espEstado\"></div>" +
      "<div class=\"esp-tabs\" id=\"espTabs\">" +
      "<button type=\"button\" data-v=\"inicio\">Inicio</button>" +
      "<button type=\"button\" data-v=\"estado\">Estado de Cuenta</button>" +
      "<button type=\"button\" data-v=\"checklist\">Checklist</button></div>" +
      "<div id=\"espCuerpo\"></div>" +
      "<div class=\"esp-pie\">¿Emergencia sin computador? <a href=\"#\" id=\"espCompleta\">Abrir la versión completa</a> " +
      "(la de antes, que sí permite cambiar datos).</div>";
    document.body.appendChild(raiz);
    document.body.classList.add("modo-espejo");
    el("espActualizar").addEventListener("click", function(){ cargar(true); });
    el("espConectar").addEventListener("click", function(){ cargar(true); });
    el("espCompleta").addEventListener("click", function(ev){
      ev.preventDefault();
      if(!confirm("La versión completa permite cambiar datos y no muestra lo último del escritorio de la misma forma. " +
                  "¿Abrirla igual?")) return;
      try{ localStorage.setItem(CLAVE_MODO_COMPLETO, "1"); }catch(e){}
      location.reload();
    });
    el("espTabs").addEventListener("click", function(ev){
      var b = ev.target.closest("button[data-v]");
      if(!b) return;
      vista = b.dataset.v;
      dibujar();
    });
  }

  function estado(texto, clase){
    var e = el("espEstado");
    if(!e) return;
    e.textContent = texto;
    e.className = "esp-estado " + (clase || "");
  }

  function dibujarSinDatos(){
    var ms = window.GFEspejoMicrosoft && window.GFEspejoMicrosoft.disponible && window.GFEspejoMicrosoft.disponible();
    var fsa = typeof window.showDirectoryPicker === "function";
    el("espConectar").hidden = !(ms || fsa);
    el("espConectar").textContent = ms ? "Entrar con mi cuenta Microsoft" : "Conectar la carpeta de OneDrive";
    el("espCuerpo").innerHTML = "<div class=\"esp-card\"><h2>Conectar con los datos</h2><p>" +
      (ms ? "Toca «Entrar con mi cuenta Microsoft» y entra con la misma cuenta del OneDrive de los computadores."
          : fsa ? "Toca «Conectar la carpeta de OneDrive» y elige la carpeta <b>FamilyExpensesSync</b> dentro de tu OneDrive."
                : "En este teléfono todavía no se puede leer OneDrive: falta activar la entrada con la cuenta Microsoft.") +
      "</p><p class=\"dim\">Los datos los deja el programa de escritorio al cerrarse (archivo espejo.json).</p></div>";
  }

  function dibujar(){
    Array.prototype.forEach.call(el("espTabs").querySelectorAll("button"), function(b){
      b.classList.toggle("on", b.dataset.v === vista);
    });
    el("espConectar").hidden = true;
    if(!datos){ dibujarSinDatos(); return; }
    if(vista === "estado") dibujarEstado();
    else if(vista === "checklist") dibujarChecklist();
    else dibujarInicio();
  }

  // ------------------------------------------------------------ Inicio
  var COLOR_MES = {CERRADO: "var(--ok)", LISTO: "var(--accent)", PROBLEMAS: "var(--warn)", FALTA_PDF: "#9a6bd1",
                   EN_CURSO: "var(--border)", SIN_DATOS: "var(--border)"};
  function dibujarInicio(){
    var ini = datos.inicio || {}, h = "";
    var rec = ini.recordatorios || [];
    h += "<div class=\"esp-card\"><h2>Qué hay que hacer</h2>" + (rec.length ? rec.map(function(r){
      return "<div class=\"" + (r[0] === "warn" ? "warn" : r[0] === "ok" ? "ok" : "") + "\">" + esc(r[1]) + "</div>";
    }).join("") : "<div class=\"ok\">✔ Nada pendiente.</div>") + "</div>";
    var meses = ini.meses || [];
    if(meses.length){
      h += "<div class=\"esp-card\"><h2>Meses de " + meses[0].anio + "</h2><div class=\"esp-meses\">" + meses.map(function(m){
        return "<div class=\"esp-mes\" style=\"border-color:" + (COLOR_MES[m.estado] || "var(--border)") + "\"><b>" +
          MESES[m.mes] + "</b>" + esc(m.icono + " " + m.texto) + (m.estado !== "LISTO" && m.detalle ? "<br><small>" +
          esc(m.detalle) + "</small>" : "") + "</div>";
      }).join("") + "</div></div>";
    }
    var u = ini.ultimo;
    if(u){
      var cobros = ini.cobros || [], pend = 0, pag = 0;
      h += "<div class=\"esp-card\"><h2>Cobro de " + MESES[u[1]] + " " + u[0] + "</h2><table><thead><tr><th>Persona</th>" +
           "<th class=\"n\">Le toca</th><th class=\"n opc\">Abonó</th><th>Estado</th></tr></thead><tbody>";
      cobros.forEach(function(c){
        var est, cls;
        if(c.titular){ est = "Titular: paga él"; cls = "dim"; }
        else if(c.pagado){ est = "✔ Pagado"; cls = "ok"; pag += Math.max(c.total, 0); }
        else if(c.total < -1){ est = "A favor " + pesos(-c.total); cls = ""; }
        else if(c.total <= 1){ est = "✔ Nada pendiente"; cls = "ok"; }
        else { est = "⏳ Pendiente"; cls = "warn"; pend += c.total; }
        h += "<tr data-p=\"" + esc(c.persona) + "\" style=\"cursor:pointer\"><td>" + esc(c.persona) + "</td><td class=\"n\">" +
             pesos(c.total) + "</td><td class=\"n opc dim\">" + (c.abonado ? pesos(c.abonado) : "—") + "</td><td class=\"" +
             cls + "\">" + est + "</td></tr>";
      });
      h += "</tbody></table><p>Por cobrar: <b>" + pesos(pend) + "</b> · ya pagado: " + pesos(pag) +
           " <span class=\"dim\">(toca una persona para ver su estado de cuenta)</span></p></div>";
    }
    el("espCuerpo").innerHTML = h;
    Array.prototype.forEach.call(el("espCuerpo").querySelectorAll("tr[data-p]"), function(tr){
      tr.addEventListener("click", function(){
        sel.persona = tr.dataset.p;
        if(u) sel.clave = u[0] + "|" + u[1];
        vista = "estado";
        dibujar();
      });
    });
  }

  // ------------------------------------------------------------ Estado de Cuenta
  function mesesDe(mapa, persona){
    return Object.keys(mapa || {}).filter(function(k){ return k.split("|")[0] === persona; })
      .map(function(k){ var p = k.split("|"); return [Number(p[1]), Number(p[2])]; })
      .sort(function(a, b){ return b[0] - a[0] || b[1] - a[1]; });
  }
  function filtros(idP, idM, persona, clave, mapa){
    var meses = mesesDe(mapa, persona);
    if(meses.length && !meses.some(function(m){ return m[0] + "|" + m[1] === clave; })) clave = meses[0][0] + "|" + meses[0][1];
    return {clave: clave, html: "<div class=\"esp-filtros\"><select id=\"" + idP + "\">" + (datos.personas || []).map(function(p){
      return "<option" + (p === persona ? " selected" : "") + ">" + esc(p) + "</option>";
    }).join("") + "</select><select id=\"" + idM + "\">" + meses.map(function(m){
      var k = m[0] + "|" + m[1];
      return "<option value=\"" + k + "\"" + (k === clave ? " selected" : "") + ">" + MESES[m[1]] + " " + m[0] + "</option>";
    }).join("") + "</select></div>"};
  }
  function grupo(titulo, cls, filas, conSigno){
    if(!filas || !filas.length) return "";
    var tot = filas.reduce(function(s, f){ return s + f.monto; }, 0);
    return "<div class=\"esp-card\"><h2 class=\"" + cls + "\">" + titulo + "</h2><table><tbody>" + filas.map(function(f){
      var d = f.nota != null ? (fechaCorta(f.fecha) + " · " + f.nota) : (f.etiqueta + (f.detalle ? " — " + f.detalle : ""));
      return "<tr><td>" + esc(d) + "</td><td class=\"n " + cls + "\">" + conSigno + pesos(f.monto) + "</td></tr>";
    }).join("") + "<tr><td><b>Subtotal</b></td><td class=\"n " + cls + "\"><b>" + conSigno + pesos(tot) + "</b></td></tr>" +
      "</tbody></table></div>";
  }
  function dibujarEstado(){
    var f = filtros("espPersona", "espMes", sel.persona, sel.clave, datos.estados);
    sel.clave = f.clave;
    var e = (datos.estados || {})[sel.persona + "|" + sel.clave];
    var h = f.html;
    if(!e){
      h += "<div class=\"esp-card dim\">" + esc(sel.persona) + " no tiene nada en ese mes.</div>";
    }else{
      var clsV = e.nivel === "alert" ? "bad" : e.nivel === "ok" ? "ok" : "dim";
      h += "<div class=\"esp-card\"><h2>" + esc(e.persona) + " — " + MESES[e.mes] + " " + e.anio + "</h2>" +
           "<div class=\"esp-veredicto " + clsV + "\">" + esc(e.veredicto) + "</div>" +
           (e.pagado ? "<div class=\"ok\">✔ Marcado como PAGADO</div>" : "<div class=\"dim\">Todavía no está marcado como pagado.</div>");
      if(e.pasos && e.pasos.length > 1){
        h += "<table class=\"esp-cuenta\" style=\"max-width:460px;margin-top:8px\"><tbody>" + e.pasos.map(function(p){
          var c = p[0] === "+" ? "bad" : p[0] === "-" ? "ok" : "";
          return "<tr><td class=\"" + c + "\" style=\"width:1.2em\"><b>" + (p[0] === "-" ? "−" : esc(p[0])) + "</b></td><td>" +
                 esc(p[1]) + "</td><td class=\"n\">" + pesos(p[2]) + "</td></tr>";
        }).join("") + "<tr class=\"tot\"><td></td><td>" + (e.total < -1 ? "A FAVOR" : "TOTAL") + "</td><td class=\"n " + clsV +
             "\">" + pesos(Math.abs(e.total)) + "</td></tr></tbody></table>";
      }
      h += "</div>";
      h += "<div class=\"esp-card\"><h2>Compras del mes (" + e.items.length + ")</h2><table><thead><tr><th class=\"opc\">Fecha</th>" +
           "<th>Detalle</th><th class=\"opc\">Tarjeta</th><th class=\"opc\">Cuota</th><th class=\"n\">Monto</th></tr></thead><tbody>" +
           e.items.map(function(i){
             var c = i.pagado_aparte ? "ok" : i.proyectado ? "dim" : "";
             return "<tr class=\"" + c + "\"><td class=\"opc\">" + fechaCorta(i.fecha) + "</td><td>" + (i.proyectado ? "⏳ " : "") +
                    esc(i.detalle) + "</td><td class=\"opc\">" + esc(i.tarjeta) + "</td><td class=\"opc\">" + esc(i.cuota) +
                    "</td><td class=\"n\">" + pesos(i.monto) + "</td></tr>";
           }).join("") + "</tbody></table></div>";
      h += grupo("✚ Se suma a tu deuda", "bad", e.suma, "+");
      h += grupo("➖ Se te descuenta (a tu favor)", "ok", e.descuenta, "−");
      h += grupo("💵 Abonos que ya hiciste", "ok", e.abonos, "−");
    }
    el("espCuerpo").innerHTML = h;
    el("espPersona").addEventListener("change", function(){ sel.persona = this.value; dibujar(); });
    el("espMes").addEventListener("change", function(){ sel.clave = this.value; dibujar(); });
  }

  // ------------------------------------------------------------ Checklist
  function dibujarChecklist(){
    var f = filtros("espPersonaCk", "espMesCk", sel.personaCk, sel.claveCk, datos.checklist);
    sel.claveCk = f.clave;
    var filas = (datos.checklist || {})[sel.personaCk + "|" + sel.claveCk] || [];
    var h = f.html;
    if(!filas.length){
      h += "<div class=\"esp-card dim\">" + esc(sel.personaCk) + " no tiene deudas en el checklist de ese mes.</div>";
    }else{
      var pagados = filas.filter(function(x){ return x.pagado; }).length;
      var falta = filas.filter(function(x){ return !x.pagado; }).reduce(function(s, x){ return s + x.monto; }, 0);
      var fila = function(x){
        return "<tr><td class=\"" + (x.pagado ? "ok" : "warn") + "\">" + (x.pagado ? "✓ Pagado" : "Pendiente") + "</td><td>" +
               esc(x.detalle) + (x.empresa ? " <span class=\"dim\">— " + esc(x.empresa) + "</span>" : "") + "</td><td class=\"n\">" +
               pesos(x.monto) + "</td></tr>";
      };
      var manual = filas.filter(function(x){ return !x.lider; }), lider = filas.filter(function(x){ return x.lider; });
      h += "<div class=\"esp-card\"><h2>" + pagados + " de " + filas.length + " pagados" + (falta > 0 ? " · falta " + pesos(falta) : "") +
           "</h2><table><tbody>" + manual.map(fila).join("") + "</tbody></table>" +
           (lider.length ? "<h2 style=\"margin-top:12px\">💳 Pagado con la tarjeta Líder (BCI)</h2><table><tbody>" +
                           lider.map(fila).join("") + "</tbody></table>" : "") + "</div>";
    }
    el("espCuerpo").innerHTML = h;
    el("espPersonaCk").addEventListener("change", function(){ sel.personaCk = this.value; dibujar(); });
    el("espMesCk").addEventListener("change", function(){ sel.claveCk = this.value; dibujar(); });
  }

  // ------------------------------------------------------------ entrada
  function activo(){
    try{ return localStorage.getItem(CLAVE_MODO_COMPLETO) !== "1"; }catch(e){ return true; }
  }
  function iniciar(){
    montar();
    dibujar();
    return cargar(false);
  }
  // en la version completa: un boton para volver al modo espejo
  function botonVolver(){
    var lugar = document.querySelector("header .brand-right");
    if(!lugar || el("espVolver")) return;
    var b = document.createElement("button");
    b.id = "espVolver"; b.type = "button"; b.className = "btn-ghost"; b.textContent = "👁 Modo espejo";
    b.title = "Volver a la vista solo para mirar";
    b.addEventListener("click", function(){ try{ localStorage.removeItem(CLAVE_MODO_COMPLETO); }catch(e){} location.reload(); });
    lugar.insertBefore(b, lugar.firstChild);
  }

  window.GFEspejo = {
    activo: activo, iniciar: iniciar, botonVolver: botonVolver,
    // para pruebas automatizadas: dibuja un espejo dado sin leer OneDrive
    usarDatos: function(d, nombreFuente){ montar(); fuente = nombreFuente || "prueba"; usar(d); },
    ir: function(v){ vista = v; dibujar(); }
  };
})();
