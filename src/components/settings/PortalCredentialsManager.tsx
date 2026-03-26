import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, KeyRound, Loader2, ChevronsUpDown, Check } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface PortalCredential {
  id: string;
  user_id: string;
  jurisdiction: string;
  portal_username: string;
  portal_password: string;
  login_url: string | null;
  permit_number: string | null;
  project_address: string | null;
  project_id: string | null;
  created_at: string;
}

const JURISDICTION_PORTALS = [
  { jurisdiction: "Washington DC - ProjectDox", url: "https://washington-dc-us.avolvecloud.com/User/Index" },
  { jurisdiction: "Washington DC - DCRA", url: "https://govservices.dcra.dc.gov/ProjectDoxWebsite/ProjectInvestigationStatus.aspx" },
  { jurisdiction: "Washington DC - ePlan", url: "https://eplan9x.dcra.dc.gov/ProjectDox/ViewProjects.aspx" },
  { jurisdiction: "Washington DC - DDOT TOPS", url: "https://tops.ddot.dc.gov/DDOTPermitSystem/DDOTPermitOnline/Login" },
  { jurisdiction: "Montgomery County MD - ePlans", url: "https://eplans.montgomerycountymd.gov/ProjectDox/Frame.aspx" },
  { jurisdiction: "Montgomery County MD - Avolve", url: "https://montgomeryco-md-us.avolvecloud.com/ProjectDox/index.html" },
  { jurisdiction: "Montgomery County MD - Permitting", url: "https://permittingservices.montgomerycountymd.gov/" },
  { jurisdiction: "Prince George's County MD", url: "https://eplans.princegeorgescountymd.gov/ProjectDox/ViewProjects.aspx" },
  { jurisdiction: "Frederick County MD - ProjectDox", url: "https://frederickco-md-us.avolvecloud.com/ProjectDox/ViewProjects.aspx" },
  { jurisdiction: "Frederick County MD - Planning", url: "https://planningandpermitting.frederickcountymd.gov/my-dashboard" },
  { jurisdiction: "Howard County MD", url: "https://howardb2cprod.b2clogin.com/" },
  { jurisdiction: "Harford County MD", url: "https://epermitcenter.harfordcountymd.gov/" },
  { jurisdiction: "Baltimore City MD - ProjectDox", url: "https://eplans.baltimorecity.gov/projectdox/" },
  { jurisdiction: "Baltimore City MD - Accela", url: "https://aca-prod.accela.com/BALTIMORE" },
  { jurisdiction: "Baltimore Housing", url: "https://cels.baltimorehousing.org/" },
  { jurisdiction: "Anne Arundel County MD", url: "https://aca-prod.accela.com/AACO/Welcome.aspx" },
  { jurisdiction: "WSSC Water", url: "https://wssc-md-us.avolvecloud.com/Portal/Login/Index/WSSC-Prod" },
  { jurisdiction: "WSSC Permits", url: "https://permits.wsscwater.com/EnerGov_Prod/SelfService" },
  { jurisdiction: "Fairfax County VA", url: "https://eplanreview.fairfaxcounty.gov/ProjectDox/" },
  { jurisdiction: "Arlington County VA", url: "https://aca-prod.accela.com/ARLINGTONCO/Login.aspx" },
  { jurisdiction: "Virginia Beach VA", url: "https://aca-prod.accela.com/cvb/default.aspx" },
  { jurisdiction: "Stafford County VA", url: "https://stafford-va-us.avolvecloud.com/ProjectDox/" },
  { jurisdiction: "Henrico County VA", url: "https://build.henrico.gov/henprod/pub/lms/Login.aspx" },
  { jurisdiction: "Chesapeake VA", url: "https://aca-prod.accela.com/CHESAPEAKE/Default.aspx" },
  { jurisdiction: "Charlottesville VA", url: "https://permits.charlottesville.gov/" },
  { jurisdiction: "Accomack County VA", url: "https://accomackcountyva-energovpub.tylerhost.net/Apps/SelfService" },
  { jurisdiction: "Harrisonburg VA", url: "https://permits.harrisonburgva.gov/default.aspx" },
  { jurisdiction: "Danville VA", url: "https://onlinepermits.danvilleva.gov/PortalProd/home/welcome" },
  { jurisdiction: "Chesterfield County VA", url: "https://aca-prod.accela.com/CHESTERFIELD/Dashboard.aspx" },
  { jurisdiction: "City of Highpoint NC", url: "https://www6.citizenserve.com/Portal/PortalController" },
  { jurisdiction: "Winston Salem NC", url: "https://www4.citizenserve.com/Portal/Login" },
  { jurisdiction: "Jacksonville NC", url: "https://jaxplans.jacksonvillenc.gov/ProjectDox/ViewProjects.aspx" },
  { jurisdiction: "Town of Garner NC", url: "" },
  { jurisdiction: "Angier NC", url: "https://www6.citizenserve.com/Portal/PortalController" },
  { jurisdiction: "Randolph County NC", url: "https://esuite.randolphcountync.gov/" },
  { jurisdiction: "Orange County NC", url: "https://centralpermits.orangecountync.gov/" },
  { jurisdiction: "New Castle County DE", url: "https://newcastleco-de-us.avolvecloud.com/Login/Index/NewCastle-Prod" },
  { jurisdiction: "Broward County FL", url: "https://dpep.broward.org/" },
  { jurisdiction: "Pompano Beach FL", url: "https://epr.pompanobeachfl.gov/ProjectDox/Profile.aspx" },
  { jurisdiction: "Lee County FL", url: "https://lee.csqrcloud.com/" },
  { jurisdiction: "Littleton CO", url: "https://permit9.littletongov.org/" },
  { jurisdiction: "City of Suffolk VA", url: "https://app03.cityworksonline.com/CLIENT_SuffolkVA-Public/login" },
  { jurisdiction: "Norfolk VA", url: "https://norfolkva.my.site.com/s/login/" },
  { jurisdiction: "Berkeley WV", url: "https://aca-prod.accela.com/BERKELEYCO/Login.aspx" },
  { jurisdiction: "Charles County MD", url: "https://land.charlescountymd.gov/EnerGov_Prod/SelfService" },
  { jurisdiction: "311 DC", url: "" },
  { jurisdiction: "Access DC", url: "" },
  { jurisdiction: "BGE (Exelon)", url: "" },
  { jurisdiction: "MDOT SHA", url: "https://mdotsha.my.site.com/" },
  { jurisdiction: "OAS Avolve (General)", url: "https://oas.avolvecloud.com/Portal/" },
];

const defaultForm = {
  jurisdiction: "",
  portal_username: "",
  portal_password: "",
  login_url: "",
};

export function PortalCredentialsManager() {
  const { user } = useAuth();
  const [credentials, setCredentials] = useState<PortalCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [jurisdictionOpen, setJurisdictionOpen] = useState(false);
  const [jurisdictionSearch, setJurisdictionSearch] = useState("");
  const commandInputRef = useRef<HTMLInputElement>(null);

  const fetchCredentials = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("portal_credentials")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Failed to load credentials");
      console.error(error);
    } else {
      setCredentials((data as PortalCredential[]) || []);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchCredentials();
  }, [fetchCredentials]);

  const openAdd = () => {
    setEditingId(null);
    setForm({ ...defaultForm });
    setJurisdictionSearch("");
    setDialogOpen(true);
  };

  const openEdit = (row: PortalCredential) => {
    setEditingId(row.id);
    setForm({
      jurisdiction: row.jurisdiction,
      portal_username: row.portal_username,
      portal_password: row.portal_password,
      login_url: row.login_url ?? "",
    });
    setJurisdictionSearch("");
    setDialogOpen(true);
  };

  const handleJurisdictionSelect = (jurisdictionName: string) => {
    const match = JURISDICTION_PORTALS.find((j) => j.jurisdiction === jurisdictionName);
    setForm((f) => ({
      ...f,
      jurisdiction: jurisdictionName,
      login_url: match ? match.url : "",
    }));
    setJurisdictionOpen(false);
  };

  const handleSave = async () => {
    if (!user) return;
    if (!form.jurisdiction.trim() || !form.portal_username.trim() || !form.portal_password.trim()) {
      toast.error("Jurisdiction, username, and password are required");
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, string | null> = {
        user_id: user.id,
        jurisdiction: form.jurisdiction.trim(),
        portal_username: form.portal_username.trim(),
        portal_password: form.portal_password.trim(),
        login_url: form.login_url.trim() || "https://washington-dc-us.avolvecloud.com/User/Index",
      };

      if (editingId) {
        const { error } = await supabase
          .from("portal_credentials")
          .update(payload)
          .eq("id", editingId)
          .eq("user_id", user.id);
        if (error) throw error;
        toast.success("Credentials updated");
      } else {
        const { error } = await supabase.from("portal_credentials").insert(payload);
        if (error) throw error;
        toast.success("Credentials added");
      }
      setDialogOpen(false);
      fetchCredentials();
    } catch (e: unknown) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    const { error } = await supabase
      .from("portal_credentials")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) {
      toast.error("Failed to delete");
    } else {
      toast.success("Credentials removed");
      setCredentials((prev) => prev.filter((c) => c.id !== id));
    }
    setDeleteId(null);
  };

  const filteredJurisdictions = JURISDICTION_PORTALS.filter((j) =>
    j.jurisdiction.toLowerCase().includes(jurisdictionSearch.toLowerCase())
  );

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" />
                Portal Credentials
              </CardTitle>
              <CardDescription>
                Add and manage login details for jurisdiction portals (used by the Portal Monitor Agent).
              </CardDescription>
            </div>
            <Button onClick={openAdd} className="bg-accent hover:bg-accent/90" data-testid="button-add-credential">
              <Plus className="mr-2 h-4 w-4" />
              Add New
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : credentials.length === 0 ? (
            <p className="text-muted-foreground text-center py-8" data-testid="text-no-credentials">
              No credentials saved. Click &quot;Add New&quot; to add jurisdiction portal logins.
            </p>
          ) : (
            <ul className="space-y-3" data-testid="list-credentials">
              {credentials.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg border bg-muted/30"
                  data-testid={`card-credential-${c.id}`}
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate" data-testid={`text-jurisdiction-${c.id}`}>{c.jurisdiction}</p>
                    <p className="text-sm text-muted-foreground truncate" data-testid={`text-username-${c.id}`}>
                      {c.portal_username}
                    </p>
                    {c.login_url && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5" data-testid={`text-url-${c.id}`}>{c.login_url}</p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => openEdit(c)} data-testid={`button-edit-${c.id}`}>
                      <Pencil className="h-4 w-4 sm:mr-1" />
                      <span className="hidden sm:inline">Edit</span>
                    </Button>
                    <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDeleteId(c.id)} data-testid={`button-delete-${c.id}`}>
                      <Trash2 className="h-4 w-4 sm:mr-1" />
                      <span className="hidden sm:inline">Delete</span>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit credentials" : "Add portal credentials"}</DialogTitle>
            <DialogDescription>
              Enter login details for a jurisdiction portal. These are used by the Portal Monitor Agent.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Jurisdiction</Label>
              <Popover open={jurisdictionOpen} onOpenChange={setJurisdictionOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={jurisdictionOpen}
                    className="w-full justify-between font-normal"
                    data-testid="combobox-jurisdiction"
                  >
                    {form.jurisdiction || "Select or type a jurisdiction..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      ref={commandInputRef}
                      placeholder="Search jurisdictions..."
                      value={jurisdictionSearch}
                      onValueChange={setJurisdictionSearch}
                      data-testid="input-jurisdiction-search"
                    />
                    <CommandList>
                      <CommandEmpty>
                        {jurisdictionSearch.trim() ? (
                          <button
                            className="w-full px-2 py-1.5 text-sm text-left cursor-pointer hover:bg-accent/10"
                            onClick={() => {
                              handleJurisdictionSelect(jurisdictionSearch.trim());
                            }}
                            data-testid="button-custom-jurisdiction"
                          >
                            Use &quot;{jurisdictionSearch.trim()}&quot; as custom jurisdiction
                          </button>
                        ) : (
                          "No jurisdictions found."
                        )}
                      </CommandEmpty>
                      <CommandGroup>
                        {filteredJurisdictions.map((j) => (
                          <CommandItem
                            key={j.jurisdiction}
                            value={j.jurisdiction}
                            onSelect={() => handleJurisdictionSelect(j.jurisdiction)}
                            data-testid={`option-jurisdiction-${j.jurisdiction}`}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                form.jurisdiction === j.jurisdiction ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <div className="flex flex-col">
                              <span>{j.jurisdiction}</span>
                              {j.url && (
                                <span className="text-xs text-muted-foreground truncate max-w-[300px]">{j.url}</span>
                              )}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="portal_username">Username</Label>
              <Input
                id="portal_username"
                placeholder="Portal username"
                value={form.portal_username}
                onChange={(e) => setForm((f) => ({ ...f, portal_username: e.target.value }))}
                data-testid="input-portal-username"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="portal_password">Password</Label>
              <Input
                id="portal_password"
                type={showPassword ? "text" : "password"}
                placeholder="Portal password"
                value={form.portal_password}
                onChange={(e) => setForm((f) => ({ ...f, portal_password: e.target.value }))}
                data-testid="input-portal-password"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={() => setShowPassword((s) => !s)}
                data-testid="button-toggle-password"
              >
                {showPassword ? "Hide" : "Show"} password
              </Button>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="login_url">Portal URL</Label>
              <Input
                id="login_url"
                placeholder="https://example.avolvecloud.com"
                value={form.login_url}
                onChange={(e) => setForm((f) => ({ ...f, login_url: e.target.value }))}
                data-testid="input-login-url"
              />
              <p className="text-xs text-muted-foreground">
                Auto-filled when selecting a jurisdiction. You can edit it manually.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                saving ||
                !form.jurisdiction.trim() ||
                !form.portal_username.trim() ||
                !form.portal_password.trim()
              }
              className="bg-accent hover:bg-accent/90"
              data-testid="button-save-credential"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {editingId ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete credentials?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the saved portal login. You can add it again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && handleDelete(deleteId)}
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
