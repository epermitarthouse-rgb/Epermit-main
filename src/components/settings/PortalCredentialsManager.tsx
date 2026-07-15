import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  PortalCredentialSafe,
  fetchPortalCredentialsList,
  createPortalCredentialViaApi,
  updatePortalCredentialViaApi,
  deletePortalCredentialViaApi,
} from "@/lib/portalCredentialsApi";
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
import { cn } from "@/lib/utils";

/**
 * UI label → seeded `utility_providers.slug` (see Sprint 2 spec). Stored in
 * `portal_credentials.jurisdiction` when a utility is selected.
 */
const UCI_UTILITY_OPTIONS: { label: string; url: string }[] = [
  { label: "PEPCO", url: "https://secure.pepco.com/service-installation-upgrades-portal/" },
  { label: "BGE", url: "" },
  { label: "Washington Gas", url: "" },
  { label: "Dominion Energy", url: "" },
  { label: "Florida Power & Light", url: "" },
  { label: "Consolidated Edison", url: "" },
  { label: "PSEG", url: "" },
  { label: "Eversource Energy", url: "" },
  { label: "Duke Energy", url: "" },
  { label: "Georgia Power", url: "" },
];

/** Legacy saved rows; keep selectable so edits are not orphaned */
const UCI_LEGACY_UTILITY_OPTIONS: { label: string; url: string }[] = [
  { label: "BGE (Exelon)", url: "" },
];

const ALL_UCI_UTILITY_OPTIONS = [...UCI_UTILITY_OPTIONS, ...UCI_LEGACY_UTILITY_OPTIONS];

const UCI_UTILITY_LABEL_SET = new Set(ALL_UCI_UTILITY_OPTIONS.map((o) => o.label));

const LEGACY_DC_LOGIN_URL = "https://washington-dc-us.avolvecloud.com/User/Index";

const JURISDICTION_PORTALS = [
  { jurisdiction: "Washington DC - ProjectDox", url: "https://washington-dc-us.avolvecloud.com/User/Index" },
  { jurisdiction: "Washington DC - DCRA", url: "https://govservices.dcra.dc.gov/ProjectDoxWebsite/ProjectInvestigationStatus.aspx" },
  { jurisdiction: "Washington DC - ePlan", url: "https://eplan9x.dcra.dc.gov/ProjectDox/ViewProjects.aspx" },
  { jurisdiction: "Washington DC - DDOT TOPS", url: "https://tops.ddot.dc.gov/DDOTPermitSystem/DDOTPermitOnline/Login" },
  { jurisdiction: "Montgomery County MD - ePlans", url: "https://eplans.montgomerycountymd.gov/ProjectDox/Frame.aspx" },
  { jurisdiction: "Montgomery County MD - Avolve", url: "https://montgomeryco-md-us.avolvecloud.com/ProjectDox/index.html" },
  { jurisdiction: "Montgomery County MD - Permitting", url: "https://permittingservices.montgomerycountymd.gov/" },
  { jurisdiction: "Prince George's County ePlan", url: "https://eplans.princegeorgescountymd.gov/Portal/Login/Index/PGC-Prod" },
  { jurisdiction: "Frederick County MD - ProjectDox", url: "https://frederickco-md-us.avolvecloud.com/ProjectDox/ViewProjects.aspx" },
  { jurisdiction: "Frederick County MD - Planning", url: "https://planningandpermitting.frederickcountymd.gov/my-dashboard" },
  { jurisdiction: "Howard County MD", url: "https://howardb2cprod.b2clogin.com/" },
  { jurisdiction: "Harford County MD", url: "https://epermitcenter.harfordcountymd.gov/" },
  { jurisdiction: "Baltimore City MD - ProjectDox", url: "https://eplans.baltimorecity.gov/projectdox/" },
  { jurisdiction: "Baltimore City MD - Accela", url: "https://aca-prod.accela.com/BALTIMORE" },
  {
    jurisdiction: "Fairfax County VA - Accela",
    url: "https://plus.fairfaxcounty.gov/CitizenAccess",
  },
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
  { jurisdiction: "MDOT SHA", url: "https://mdotsha.my.site.com/" },
  { jurisdiction: "OAS Avolve (General)", url: "https://oas.avolvecloud.com/Portal/" },
];

const defaultForm = {
  jurisdiction: "",
  utility: "",
  portal_username: "",
  portal_password: "",
  login_url: "",
};

function isSavedUtilityCredential(storedJurisdiction: string): boolean {
  return UCI_UTILITY_LABEL_SET.has(storedJurisdiction.trim());
}

function utilityOptionTestId(label: string): string {
  return `option-utility-${label.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export function PortalCredentialsManager() {
  const { user } = useAuth();
  const [credentials, setCredentials] = useState<PortalCredentialSafe[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [jurisdictionOpen, setJurisdictionOpen] = useState(false);
  const [jurisdictionSearch, setJurisdictionSearch] = useState("");
  const [utilityOpen, setUtilityOpen] = useState(false);
  const [utilitySearch, setUtilitySearch] = useState("");
  const commandInputRef = useRef<HTMLInputElement>(null);
  const utilityCommandInputRef = useRef<HTMLInputElement>(null);

  const fetchCredentials = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const list = await fetchPortalCredentialsList();
      setCredentials(list);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load credentials");
      console.error(e);
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
    setUtilitySearch("");
    setDialogOpen(true);
  };

  const openEdit = (row: PortalCredentialSafe) => {
    setEditingId(row.id);
    const stored = row.jurisdiction.trim();
    if (isSavedUtilityCredential(stored)) {
      setForm({
        jurisdiction: "",
        utility: stored,
        portal_username: row.portal_username,
        portal_password: "",
        login_url: row.login_url ?? "",
      });
    } else {
      setForm({
        jurisdiction: row.jurisdiction,
        utility: "",
        portal_username: row.portal_username,
        portal_password: "",
        login_url: row.login_url ?? "",
      });
    }
    setJurisdictionSearch("");
    setUtilitySearch("");
    setDialogOpen(true);
  };

  const handleJurisdictionSelect = (jurisdictionName: string) => {
    const match = JURISDICTION_PORTALS.find((j) => j.jurisdiction === jurisdictionName);
    setForm((f) => ({
      ...f,
      jurisdiction: jurisdictionName,
      utility: "",
      login_url: match ? match.url : "",
    }));
    setJurisdictionOpen(false);
  };

  const handleUtilitySelect = (utilityLabel: string) => {
    const match = ALL_UCI_UTILITY_OPTIONS.find((u) => u.label === utilityLabel);
    setForm((f) => ({
      ...f,
      utility: utilityLabel,
      jurisdiction: "",
      login_url: match ? match.url : "",
    }));
    setUtilityOpen(false);
  };

  const handleSave = async () => {
    if (!user) return;
    const jurisdictionPayload = form.utility.trim() || form.jurisdiction.trim();
    if (!jurisdictionPayload || !form.portal_username.trim()) {
      toast.error("Select a jurisdiction or a utility provider, and enter a username");
      return;
    }

    if (!editingId && !form.portal_password.trim()) {
      toast.error("Password is required for new credentials");
      return;
    }

    setSaving(true);
    try {
      const trimmedUrl = form.login_url.trim();
      const loginUrl = trimmedUrl
        ? trimmedUrl
        : UCI_UTILITY_LABEL_SET.has(jurisdictionPayload)
          ? ""
          : LEGACY_DC_LOGIN_URL;

      if (editingId) {
        await updatePortalCredentialViaApi(editingId, {
          jurisdiction: jurisdictionPayload,
          portal_username: form.portal_username.trim(),
          login_url: loginUrl,
          ...(form.portal_password.trim()
            ? { portal_password: form.portal_password.trim() }
            : {}),
        });
        toast.success("Credentials updated");
      } else {
        await createPortalCredentialViaApi({
          jurisdiction: jurisdictionPayload,
          portal_username: form.portal_username.trim(),
          portal_password: form.portal_password.trim(),
          login_url: loginUrl,
        });
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
    try {
      await deletePortalCredentialViaApi(id);
      toast.success("Credentials removed");
      setCredentials((prev) => prev.filter((c) => c.id !== id));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
    setDeleteId(null);
  };

  const filteredJurisdictions = JURISDICTION_PORTALS.filter((j) =>
    j.jurisdiction.toLowerCase().includes(jurisdictionSearch.toLowerCase()),
  );

  const filteredUtilities = ALL_UCI_UTILITY_OPTIONS.filter((u) =>
    u.label.toLowerCase().includes(utilitySearch.toLowerCase()),
  );

  const hasPortalTarget = !!(form.utility.trim() || form.jurisdiction.trim());

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
                Add and manage logins for jurisdiction permit portals and priority utility provider portals (Portal Monitor and UCI). Passwords are stored encrypted and are never shown back.
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
              No credentials saved. Click &quot;Add New&quot; to add permit or utility portal logins.
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
                      {c.password_configured ? (
                        <Badge variant="secondary" className="ml-2 align-middle text-[10px] font-medium">
                          Configured
                        </Badge>
                      ) : null}
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
              Enter portal login details. Passwords remain encrypted server-side and are never loaded into this form.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Jurisdiction</Label>
              <p className="text-xs text-muted-foreground">Use this for permit portals.</p>
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
              <Label>Utility</Label>
              <p className="text-xs text-muted-foreground">Use this for utility coordination portals.</p>
              <Popover open={utilityOpen} onOpenChange={setUtilityOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={utilityOpen}
                    className="w-full justify-between font-normal"
                    data-testid="combobox-utility"
                  >
                    {form.utility || "Select a utility provider..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      ref={utilityCommandInputRef}
                      placeholder="Search utilities..."
                      value={utilitySearch}
                      onValueChange={setUtilitySearch}
                      data-testid="input-utility-search"
                    />
                    <CommandList>
                      <CommandEmpty>No utility providers found.</CommandEmpty>
                      <CommandGroup>
                        {filteredUtilities.map((u) => (
                          <CommandItem
                            key={u.label}
                            value={u.label}
                            onSelect={() => handleUtilitySelect(u.label)}
                            data-testid={utilityOptionTestId(u.label)}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                form.utility === u.label ? "opacity-100" : "opacity-0",
                              )}
                            />
                            <div className="flex flex-col">
                              <span>{u.label}</span>
                              {u.url ? (
                                <span className="text-xs text-muted-foreground truncate max-w-[300px]">{u.url}</span>
                              ) : null}
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
                placeholder={
                  editingId
                    ? "Leave blank to keep existing password"
                    : "Portal password"
                }
                value={form.portal_password}
                onChange={(e) => setForm((f) => ({ ...f, portal_password: e.target.value }))}
                data-testid="input-portal-password"
                autoComplete="new-password"
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
                Auto-filled when you pick a permit jurisdiction. Utility portals usually leave this blank unless you know
                the login URL.
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
                !hasPortalTarget ||
                !form.portal_username.trim() ||
                (!editingId && !form.portal_password.trim())
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
