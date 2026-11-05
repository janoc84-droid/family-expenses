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
  var sel = {persona: "", clave: "", personaCk: "", claveCk: "", claveGd: "", personaGd: "", buscarGd: ""};
  var fotoLista = null;        // foto ya armada, por si el telefono pide un segundo toque para enviarla

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

  // Opcion B (05-11-2026): el usuario elige espejo.json con el selector de archivos del telefono
  // (OneDrive aparece ahi: en Android en «Examinar», en iPhone dentro de la app «Archivos»).
  function esEspejo(d){ return d && typeof d === "object" && d.version && d.inicio && d.estados; }
  function leerArchivo(archivo){
    if(!archivo) return;
    estado("Leyendo «" + archivo.name + "»…", "");
    archivo.text().then(function(t){
      var d = JSON.parse(t);
      if(!esEspejo(d)) throw new Error("no es el archivo espejo.json del programa");
      fuente = "el archivo que elegiste (" + archivo.name + ")";
      idbSet(CLAVE_CACHE, d);
      usar(d);
    }).catch(function(e){
      estado("Ese archivo no sirvió: " + (e && e.message ? e.message : e) +
             ". Elige FamilyExpensesSync → espejo.json en tu OneDrive.", "warn");
    });
  }
  // iPhone/iPad (usuario 05-11-2026: "solamente me deja foto, tomar una foto, grabar video o seleccionar archivo...
  // deberia aparecer la opcion de abrir OneDrive"): pidiendo solo archivos .json, el iPhone salta el menu de fotos y
  // camara y abre directo la app «Archivos», donde esta OneDrive. En Android no se filtra (algunos selectores
  // esconden el .json de OneDrive si se filtra por tipo).
  function esIos(){
    return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }
  function abrirArchivo(){
    var i = el("espArchivo");
    if(esIos()) i.setAttribute("accept", ".json,application/json,text/plain");
    i.value = "";
    i.click();
  }
  // en el telefono no hay ni carpeta ni cuenta Microsoft: «Actualizar» = volver a elegir el archivo
  function soloArchivo(){
    var ms = window.GFEspejoMicrosoft && window.GFEspejoMicrosoft.disponible && window.GFEspejoMicrosoft.disponible();
    return !ms && typeof window.showDirectoryPicker !== "function";
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
           " · leídos desde " + fuente + "." +
           (fuente.indexOf("última copia") >= 0 ? " Para ver lo más nuevo toca «📂 Abrir mis datos»." : ""), "ok");
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
      "#espejo .esp-compartir{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:-4px 0 12px;}" +
      "#espejo .esp-compartir .esp-msg{font-size:.85rem;flex-basis:100%;}" +
      "#espejo input[type=search]{padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface-2);color:var(--text);min-width:0;flex:1 1 160px;}" +
      "#espejo .esp-rep{font-size:.8rem;color:var(--text-dim);}" +
      "#espejo .esp-foto-titulo{font-weight:700;font-size:1.05rem;margin:0 0 8px;padding:8px 6px 0;}" +
      "#espejo .esp-pie a{color:var(--text-dim);}" +
      "@media (max-width:600px){#espejo{padding:8px 10px 30px;} #espejo th.opc,#espejo td.opc{display:none;}}";
    document.head.appendChild(css);
    var raiz = document.createElement("div");
    raiz.id = "espejo";
    raiz.innerHTML =
      "<div class=\"esp-top\"><div><h1>🏠 Gastos Familiares</h1>" +
      "<div class=\"esp-sub\">Modo espejo: aquí solo se mira. Todo se carga en los computadores.</div></div>" +
      "<div><button type=\"button\" class=\"esp-btn\" id=\"espActualizar\">↻ Actualizar</button> " +
      "<button type=\"button\" class=\"esp-btn\" id=\"espConectar\" hidden>Conectar…</button> " +
      "<button type=\"button\" class=\"esp-btn pri\" id=\"espAbrir\">📂 Abrir mis datos</button>" +
      "<input type=\"file\" id=\"espArchivo\" hidden></div></div>" +
      "<div class=\"esp-estado\" id=\"espEstado\"></div>" +
      "<div class=\"esp-sub\" id=\"espAyudaIos\" hidden>📱 En el iPhone: «📂 Abrir mis datos» → abajo «Explorar» → " +
      "<b>OneDrive</b> → FamilyExpensesSync → espejo.json. ¿No aparece OneDrive? En «Explorar» toca <b>⋯</b> (arriba a la " +
      "derecha) → «Editar» → activa <b>OneDrive</b> (con la app de OneDrive abierta una vez con tu cuenta).</div>" +
      "<div class=\"esp-tabs\" id=\"espTabs\">" +
      "<button type=\"button\" data-v=\"inicio\">Inicio</button>" +
      "<button type=\"button\" data-v=\"estado\">Estado de Cuenta</button>" +
      "<button type=\"button\" data-v=\"diarios\">Gastos Diarios</button>" +
      "<button type=\"button\" data-v=\"checklist\">Checklist</button></div>" +
      "<div class=\"esp-compartir\" id=\"espCompartir\" hidden>" +
      "<button type=\"button\" class=\"esp-btn pri\" id=\"espFoto\">📷 Enviar como foto</button>" +
      "<button type=\"button\" class=\"esp-btn\" id=\"espWhatsapp\">💬 Enviar por WhatsApp</button>" +
      "<button type=\"button\" class=\"esp-btn pri\" id=\"espFotoLista\" hidden>📤 Enviar la foto (ya está lista)</button>" +
      "<div class=\"esp-msg\" id=\"espMsgComp\"></div></div>" +
      "<div id=\"espCuerpo\"></div>" +
      "<div class=\"esp-pie\">¿Emergencia sin computador? <a href=\"#\" id=\"espCompleta\">Abrir la versión completa</a> " +
      "(la de antes, que sí permite cambiar datos).</div>";
    document.body.appendChild(raiz);
    document.body.classList.add("modo-espejo");
    el("espActualizar").addEventListener("click", function(){ if(soloArchivo()) abrirArchivo(); else cargar(true); });
    el("espAbrir").addEventListener("click", abrirArchivo);
    el("espFoto").addEventListener("click", compartirFoto);
    el("espFotoLista").addEventListener("click", function(){ if(fotoLista) enviarArchivo(fotoLista.archivo, fotoLista.texto); });
    el("espWhatsapp").addEventListener("click", compartirWhatsapp);
    el("espArchivo").addEventListener("change", function(){ leerArchivo(this.files && this.files[0]); });
    el("espAyudaIos").hidden = !esIos();
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
                : "Toca «📂 Abrir mis datos» y elige, en tu <b>OneDrive</b>, la carpeta <b>FamilyExpensesSync</b> y " +
                  "dentro el archivo <b>espejo.json</b>. En iPhone se abre la app «Archivos»: toca abajo «Explorar» → OneDrive; en " +
                  "Android, en el menú ☰ o «Examinar» (necesitas la app de OneDrive instalada).") +
      "</p><p class=\"dim\">Los datos los deja el programa de escritorio al cerrarse (archivo espejo.json).</p></div>";
  }

  function dibujar(){
    Array.prototype.forEach.call(el("espTabs").querySelectorAll("button"), function(b){
      b.classList.toggle("on", b.dataset.v === vista);
    });
    el("espConectar").hidden = true;
    el("espCompartir").hidden = !datos;
    msgComp("", "");
    if(!datos){ dibujarSinDatos(); return; }
    if(vista === "estado") dibujarEstado();
    else if(vista === "diarios") dibujarDiarios();
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
    return {clave: clave, html: "<div class=\"esp-filtros\" data-html2canvas-ignore><select id=\"" + idP + "\">" + (datos.personas || []).map(function(p){
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

  // ------------------------------------------------------------ Gastos Diarios (05-11-2026)
  // Usuario: "tambien hay que dejar los gastos diarios. Y no solamente los del mes". Todas las notas, en el mes en
  // que las muestra el escritorio (CMR/Lider despues del corte -> mes siguiente), con buscador y filtro por persona.
  function hoyClave(){ var d = new Date(); return [d.getFullYear(), d.getMonth() + 1]; }
  function mesesGd(){
    return Object.keys(datos.diarios || {}).map(function(k){ var p = k.split("|"); return [Number(p[0]), Number(p[1])]; })
      .sort(function(a, b){ return b[0] - a[0] || b[1] - a[1]; });
  }
  function personasGd(){
    var vistas = {};
    Object.keys(datos.diarios || {}).forEach(function(k){
      datos.diarios[k].forEach(function(n){ (n.reparto || []).forEach(function(r){ vistas[r[0]] = 1; }); });
    });
    return Object.keys(vistas).sort(function(a, b){ return a.localeCompare(b, "es"); });
  }
  function etiquetaGd(){
    if(sel.claveGd === "todos") return "Todos los meses";
    var p = sel.claveGd.split("|");
    return MESES[Number(p[1])] + " " + p[0];
  }
  function dibujarDiarios(){
    var meses = mesesGd(), hoy = hoyClave();
    if(!sel.claveGd){
      var actual = meses.filter(function(m){ return m[0] < hoy[0] || (m[0] === hoy[0] && m[1] <= hoy[1]); })[0] || meses[0];
      sel.claveGd = actual ? actual[0] + "|" + actual[1] : "todos";
    }
    var total = Object.keys(datos.diarios || {}).reduce(function(s, k){ return s + datos.diarios[k].length; }, 0);
    var h = "<div class=\"esp-filtros\" data-html2canvas-ignore><select id=\"espMesGd\"><option value=\"todos\"" +
      (sel.claveGd === "todos" ? " selected" : "") + ">Todos los meses (" + total + " notas)</option>" + meses.map(function(m){
        var k = m[0] + "|" + m[1], futuro = m[0] > hoy[0] || (m[0] === hoy[0] && m[1] > hoy[1]);
        return "<option value=\"" + k + "\"" + (k === sel.claveGd ? " selected" : "") + ">" + MESES[m[1]] + " " + m[0] +
               " (" + datos.diarios[k].length + ")" + (futuro ? " · cuotas que vienen" : "") + "</option>";
      }).join("") + "</select><select id=\"espPersonaGd\"><option value=\"\">Todas las personas</option>" +
      personasGd().map(function(p){
        return "<option" + (p === sel.personaGd ? " selected" : "") + ">" + esc(p) + "</option>";
      }).join("") + "</select><input type=\"search\" id=\"espBuscarGd\" placeholder=\"Buscar (detalle o categoría)\" value=\"" +
      esc(sel.buscarGd) + "\"></div><div id=\"espGdLista\"></div>";
    el("espCuerpo").innerHTML = h;
    el("espMesGd").addEventListener("change", function(){ sel.claveGd = this.value; listaDiarios(); });
    el("espPersonaGd").addEventListener("change", function(){ sel.personaGd = this.value; listaDiarios(); });
    el("espBuscarGd").addEventListener("input", function(){ sel.buscarGd = this.value; listaDiarios(); });
    listaDiarios();
  }
  // las notas que pasan los filtros, por mes: [[clave, [nota...]]]; con persona, `monto` = SU parte
  function notasGd(){
    var hoy = hoyClave(), buscar = sel.buscarGd.trim().toLowerCase();
    var claves = sel.claveGd === "todos" ? mesesGd().map(function(m){ return m[0] + "|" + m[1]; }) : [sel.claveGd];
    // en "Todos": primero de este mes hacia atras; al final, los meses que vienen (solo cuotas ya programadas)
    var esFuturo = function(k){ var p = k.split("|").map(Number); return p[0] > hoy[0] || (p[0] === hoy[0] && p[1] > hoy[1]); };
    claves = claves.filter(function(k){ return !esFuturo(k); }).concat(claves.filter(esFuturo).reverse());
    return claves.map(function(k){
      var notas = ((datos.diarios || {})[k] || []).map(function(n){
        if(!sel.personaGd) return n;
        var r = (n.reparto || []).filter(function(x){ return x[0] === sel.personaGd; })[0];
        return r ? Object.assign({}, n, {monto: r[1], pagadoPersona: r[2]}) : null;
      }).filter(function(n){
        return n && (!buscar || (n.detalle + " " + n.categoria).toLowerCase().indexOf(buscar) >= 0);
      });
      return [k, notas, esFuturo(k)];
    }).filter(function(g){ return g[1].length; });
  }
  function listaDiarios(){
    var grupos = notasGd(), h = "";
    var suma = function(ns){ return ns.reduce(function(s, n){ return s + n.monto; }, 0); };
    var cuantas = grupos.reduce(function(s, g){ return s + g[1].length; }, 0);
    if(!grupos.length){
      el("espGdLista").innerHTML = "<div class=\"esp-card dim\">No hay gastos diarios con ese filtro.</div>";
      return;
    }
    if(grupos.length > 1){
      h += "<div class=\"esp-card\"><b>" + cuantas + " notas · total " + pesos(grupos.reduce(function(s, g){ return s + suma(g[1]); }, 0)) +
           "</b>" + (sel.personaGd ? " <span class=\"dim\">(la parte de " + esc(sel.personaGd) + ")</span>" : "") + "</div>";
    }
    var futuros = false;
    grupos.forEach(function(g){
      var p = g[0].split("|");
      if(g[2] && !futuros){ futuros = true; h += "<h2 style=\"font-size:1rem;margin:16px 0 8px\">Meses que vienen (cuotas ya programadas)</h2>"; }
      h += "<div class=\"esp-card\"><h2>" + MESES[Number(p[1])] + " " + p[0] + " · " + g[1].length + " notas · " + pesos(suma(g[1])) +
           "</h2><table><thead><tr><th>Fecha</th><th>Detalle</th><th class=\"opc\">Medio de pago</th><th class=\"n\">Monto</th></tr>" +
           "</thead><tbody>" + g[1].map(function(n){
             var rep = (n.reparto || []).map(function(r){ return esc(r[0]) + " " + pesos(r[1]) + (r[2] ? " ✓" : ""); }).join(" · ");
             return "<tr><td style=\"white-space:nowrap\">" + fechaCorta(n.fecha).slice(0, 5) + "</td><td>" + esc(n.detalle) +
                    (n.cuota ? " <span class=\"dim\">(" + esc(n.cuota) + ")</span>" : "") +
                    "<div class=\"esp-rep\">" + esc(n.categoria) + (rep ? " · 👥 " + rep : "") + "</div></td><td class=\"opc\">" +
                    esc(n.medio) + "</td><td class=\"n\">" + pesos(n.monto) + "</td></tr>";
           }).join("") + "</tbody></table></div>";
    });
    el("espGdLista").innerHTML = h;
  }

  // ------------------------------------------------------------ enviar: foto y WhatsApp (05-11-2026)
  // Usuario: "no puedo modificar los datos, pero si puedo tener la opcion de enviarlo a traves de WhatsApp o a traves
  // de una foto. Tal como lo hacemos con la aplicacion". Solo lee lo que esta en pantalla; nunca cambia datos.
  function msgComp(texto, clase){
    var m = el("espMsgComp");
    if(!m) return;
    m.textContent = texto;
    m.className = "esp-msg " + (clase || "");
    if(!texto) el("espFotoLista").hidden = true;
  }
  function estadoActual(){ return (datos.estados || {})[sel.persona + "|" + sel.clave]; }
  function tituloVista(){
    if(vista === "estado") return "Estado de cuenta de " + sel.persona + " — " + etiquetaClave(sel.clave);
    if(vista === "checklist") return "Checklist de pagos de " + sel.personaCk + " — " + etiquetaClave(sel.claveCk);
    if(vista === "diarios") return "Gastos diarios — " + etiquetaGd() + (sel.personaGd ? " — " + sel.personaGd : "");
    return "Gastos Familiares — resumen";
  }
  function etiquetaClave(k){ var p = String(k || "").split("|"); return p.length > 1 ? MESES[Number(p[1])] + " " + p[0] : ""; }
  function textoVista(){
    var t = tituloVista(), lineas = [];
    if(vista === "estado"){
      var e = estadoActual();
      if(e && e.mensaje) return e.mensaje.replace("en PDF", "en una foto");
      return t;
    }
    if(vista === "checklist"){
      ((datos.checklist || {})[sel.personaCk + "|" + sel.claveCk] || []).forEach(function(x){
        lineas.push((x.pagado ? "✓ " : "⏳ ") + x.detalle + ": " + pesos(x.monto));
      });
    }else if(vista === "diarios"){
      var tot = 0;
      notasGd().forEach(function(g){
        if(sel.claveGd === "todos") lineas.push("— " + etiquetaClave(g[0]));
        g[1].forEach(function(n){ tot += n.monto; lineas.push(fechaCorta(n.fecha).slice(0, 5) + " " + n.detalle + ": " + pesos(n.monto)); });
      });
      lineas.push("Total: " + pesos(tot));
    }else{
      var u = (datos.inicio || {}).ultimo;
      if(u) t = "Cobro de " + MESES[u[1]] + " " + u[0];
      ((datos.inicio || {}).cobros || []).forEach(function(c){
        if(c.titular) return;
        lineas.push(c.persona + ": " + (c.pagado ? "✔ pagado" : c.total < -1 ? "a favor " + pesos(-c.total)
                                        : c.total <= 1 ? "nada pendiente" : "debe " + pesos(c.total)));
      });
    }
    var texto = t + "\n" + lineas.join("\n");
    if(texto.length > 1800) texto = texto.slice(0, 1750).replace(/\n[^\n]*$/, "") + "\n… (el resto va en la foto)";
    return texto;
  }
  function telefonoWa(){
    var p = vista === "estado" ? sel.persona : vista === "checklist" ? sel.personaCk : vista === "diarios" ? sel.personaGd : "";
    var tel = p ? String(((datos.telefonos || {})[p]) || "").replace(/\D/g, "") : "";
    if(tel.length === 9 && tel.charAt(0) === "9") tel = "56" + tel;      // igual que normalizar_telefono_cl
    return tel;
  }
  function compartirWhatsapp(){
    var link = "https://wa.me/" + telefonoWa() + "?text=" + encodeURIComponent(textoVista());
    window.open(link, "_blank");
    msgComp("Se abrió WhatsApp con el mensaje listo" + (telefonoWa() ? "." : ": elige a quién mandarlo.") +
            " Si quieres mandar también la foto, toca «📷 Enviar como foto».", "ok");
  }
  function nombreFoto(){
    return tituloVista().replace(/[—]/g, "-").replace(/[^\wÁÉÍÓÚÑáéíóúñ -]+/g, "").replace(/\s+/g, "_") + ".png";
  }
  function capturar(){
    if(typeof html2canvas !== "function") return Promise.reject(new Error("no se pudo cargar la librería de imagen"));
    var cuerpo = el("espCuerpo");
    var titulo = document.createElement("div");
    titulo.className = "esp-foto-titulo";
    titulo.textContent = tituloVista();
    cuerpo.insertBefore(titulo, cuerpo.firstChild);
    var alto = cuerpo.scrollHeight;
    var escala = Math.min(2, 15000 / Math.max(alto, 1));
    var fin = function(){ if(titulo.parentNode) titulo.parentNode.removeChild(titulo); };
    if(escala < 0.8){ fin(); return Promise.reject(new Error("es demasiado larga para una foto: elige un solo mes o filtra por persona")); }
    var fondo = getComputedStyle(document.body).backgroundColor || "#ffffff";
    return html2canvas(cuerpo, {scale: escala, backgroundColor: fondo, useCORS: true}).then(function(canvas){
      fin();
      return new Promise(function(ok, mal){
        canvas.toBlob(function(b){ if(b) ok(b); else mal(new Error("no se pudo armar la imagen")); }, "image/png");
      });
    }, function(e){ fin(); throw e; });
  }
  function enviarArchivo(archivo, texto){
    var datosShare = {files: [archivo], title: tituloVista()};
    if(texto) datosShare.text = texto;
    return navigator.share(datosShare).then(function(){
      fotoLista = null; msgComp("✔ Listo.", "ok");
    }).catch(function(e){
      if(e && e.name === "AbortError"){ msgComp("", ""); return; }
      // el telefono a veces pide un toque nuevo porque armar la foto tomo unos segundos
      fotoLista = {archivo: archivo, texto: texto};
      el("espFotoLista").hidden = false;
      msgComp("La foto está lista: toca «📤 Enviar la foto» y elige WhatsApp.", "ok");
    });
  }
  function compartirFoto(){
    msgComp("Preparando la foto…", "");
    var texto = vista === "estado" && estadoActual() ? textoVista() : "";
    capturar().then(function(blob){
      var archivo = new File([blob], nombreFoto(), {type: "image/png"});
      if(navigator.canShare && navigator.share && navigator.canShare({files: [archivo]})){
        return enviarArchivo(archivo, texto);      // telefono: se abre el menu de compartir (WhatsApp, etc.)
      }
      // computador: se descarga y se copia al portapapeles para pegarla en WhatsApp con Ctrl+V
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = archivo.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(a.href); }, 5000);
      var copiar = (navigator.clipboard && window.ClipboardItem)
        ? navigator.clipboard.write([new ClipboardItem({"image/png": blob})]).then(function(){ return true; }, function(){ return false; })
        : Promise.resolve(false);
      return copiar.then(function(copiada){
        msgComp((copiada ? "✔ Foto copiada: pégala en el chat de WhatsApp con Ctrl+V. " : "") +
                "También quedó descargada como «" + archivo.name + "».", "ok");
      });
    }).catch(function(e){
      msgComp("No se pudo armar la foto: " + (e && e.message ? e.message : e) + ".", "warn");
    });
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
