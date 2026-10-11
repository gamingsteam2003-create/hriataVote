import axios from "axios";

export const api = axios.create({
  baseURL: `${process.env.REACT_APP_BACKEND_URL}/api/v1`,
  withCredentials: true,
  timeout: 20000,
});

const readCookie = (name) =>
  document.cookie.split("; ").find((c) => c.startsWith(name + "="))?.split("=")[1];

api.interceptors.request.use((cfg) => {
  const token = readCookie("vs_csrf");
  if (token && cfg.method !== "get") cfg.headers["X-CSRF-Token"] = decodeURIComponent(token);
  return cfg;
});

export function errMsg(e) {
  const er = e?.response?.data?.error;
  if (!er) return e?.response ? "Request failed." : "Network error: the server could not be reached.";
  if (Array.isArray(er.details) && er.details.length)
    return `${er.message} ${er.details.map((d) => (d.field ? `${d.field}: ${d.msg}` : d.msg)).join(" ")}`;
  return er.message;
}

export const errCode = (e) => e?.response?.data?.error?.code;

export const fmt = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

export const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
