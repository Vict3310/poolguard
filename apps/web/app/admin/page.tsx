import { redirect } from "next/navigation";

/** The operator console lives inside the workspace shell. */
export default function AdminRedirect() {
  redirect("/app/admin");
}
