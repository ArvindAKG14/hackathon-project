import * as store from "./store.js";

export function seed(): void {
  store.users.set("u1", { id: "u1", name: "Priya (daughter)" });
  store.users.set("u2", { id: "u2", name: "Sam (caregiver)" });

  store.seniors.set("s1", {
    id: "s1",
    name: "Kamala Devi",
    age: 78,
    conditions: ["Hypertension"],
    emergencyContact: "+1 555 0101",
  });
  store.seniors.set("s2", {
    id: "s2",
    name: "Raj Kumar",
    age: 82,
    conditions: ["Type 2 diabetes"],
    emergencyContact: "+1 555 0102",
  });
  store.seniors.set("s3", {
    id: "s3",
    name: "Margaret Lee",
    age: 75,
    conditions: ["COPD"],
    emergencyContact: "+1 555 0103",
  });

  // Overlapping access so the access rules are visible: u1 sees s1+s2, u2 sees s2+s3.
  store.grantAccess("u1", "s1");
  store.grantAccess("u1", "s2");
  store.grantAccess("u2", "s2");
  store.grantAccess("u2", "s3");
}
