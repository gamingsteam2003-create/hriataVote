import axios from "axios";

export const api = axios.create({
  baseURL: `${process.env.REACT_APP_BACKEND_URL}/api/v1`,
  withCredentials: true,
  timeout: 20000,
});

const readCookie = (name) => {
  const cookie = document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${name}=`));

  return cookie ? cookie.slice(name.length + 1) : null;
};

api.interceptors.request.use((cfg) => {
  cfg.headers = cfg.headers || {};

  const method = (cfg.method || "get").toLowerCase();
  const token = readCookie("vs_csrf");

  if (token && !["get", "head", "options"].includes(method)) {
    try {
      cfg.headers["X-CSRF-Token"] = decodeURIComponent(token);
    } catch {
      cfg.headers["X-CSRF-Token"] = token;
    }
  }

  return cfg;
});

export function errMsg(e) {
  const er = e?.response?.data?.error;

  if (!er) {
    return e?.response
      ? "Request failed."
      : "Network error: the server could not be reached.";
  }

  if (Array.isArray(er.details) && er.details.length) {
    return `${er.message} ${er.details
      .map((d) => (d.field ? `${d.field}: ${d.msg}` : d.msg))
      .join(" ")}`;
  }

  return er.message;
}

export const errCode = (e) => e?.response?.data?.error?.code;

export const fmt = (iso) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

export const toLocalInput = (iso) => {
  if (!iso) return "";

  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate()
  )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
