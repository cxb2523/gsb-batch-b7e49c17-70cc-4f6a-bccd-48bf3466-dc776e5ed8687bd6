import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getProfileData } from "@/lib/profile";
import ProfileClient from "./ProfileClient";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const data = await getProfileData(session.user.id);
  if (!data) redirect("/signin");

  const { tab } = await searchParams;
  // A repeated ?tab= arrives as an array; show the first, like the old client-side read did.
  return <ProfileClient initialData={data} tab={[tab].flat()[0] || "profile"} />;
}
