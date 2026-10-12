import axios from “axios”;

export const api = axios.create({
baseURL: ${process.env.REACT_APP_BACKEND_URL?.replace(/\/+$/, "")}/api/v1,
withCredentials: true,
timeout: 20000,
});

// Fetch a CSRF token only when an authenticated action needs it.
// The backend must provide this token for the current session.
let csrfToken = null;

export function setCsrfToken(token) {
csrfToken = token || null;
}

const csrfExemptPaths = [
“/auth/login”,
“/auth/mfa/login”,
“/auth/reset-password”,
];

api.interceptors.request.use(async (config) => {
const method = (config.method || “get”).toLowerCase();
const path = (config.url || “”).split(”?”)[0].replace(//+$/, “”);

if ([“get”, “head”, “options”].includes(method)) {
return config;
}

if (csrfExemptPaths.includes(path)) {
return config;
}

if (!csrfToken) {
const response = await axios.get(
${api.defaults.baseURL}/auth/csrf,
{
withCredentials: true,
timeout: 20000,
}
);

csrfToken = response.data?.csrf_token || null;

}

if (!csrfToken) {
throw new Error(
“Unable to obtain the CSRF security token. Please sign in again.”
);
}

config.headers = config.headers || {};

if (typeof config.headers.set === “function”) {
config.headers.set(“X-CSRF-Token”, csrfToken);
} else {
config.headers[“X-CSRF-Token”] = csrfToken;
}

return config;
});

export function errMsg(error) {
const err = error?.response?.data?.error;

if (!err) {
if (error?.response) {
return error.response.data?.detail || “Request failed.”;
}

return (
  error?.message ||
  "Network error: the server could not be reached."
);

}

if (Array.isArray(err.details) && err.details.length) {
return ${err.message} ${err.details .map((detail) => detail.field ? ${detail.field}: ${detail.msg} : detail.msg ) .join(" ")};
}

return err.message || “An unexpected error occurred.”;
}

export const errCode = (error) =>
error?.response?.data?.error?.code;

export const fmt = (iso) =>
iso
? new Date(iso).toLocaleString(undefined, {
dateStyle: “medium”,
timeStyle: “short”,
})
: “—”;

export const toLocalInput = (iso) => {
if (!iso) return “”;

const date = new Date(iso);
const pad = (number) => String(number).padStart(2, “0”);

return ${date.getFullYear()}-${pad( date.getMonth() + 1 )}-${pad(date.getDate())}T${pad( date.getHours() )}:${pad(date.getMinutes())};
};
