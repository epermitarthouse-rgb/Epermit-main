import { useMemo, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProjects } from "@/hooks/useProjects";
import {
  adminCreateUserSchema,
  ASSIGNABLE_INITIAL_PROJECT_ROLES,
  emptyAdminCreateUserForm,
  type AdminCreateUserFormValues,
} from "@/lib/adminCreateUserValidation";
import { PROJECT_ROLE_LABELS, type ProjectRole } from "@/lib/governanceConstants";

type AdminCreateUserDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (payload: {
    full_name: string;
    email: string;
    temporary_password: string;
    company_name?: string | null;
    job_title?: string | null;
    project_id?: string | null;
    project_role?: ProjectRole | null;
  }) => Promise<{ user_id: string }>;
};

export function AdminCreateUserDialog({
  open,
  onOpenChange,
  onCreate,
}: AdminCreateUserDialogProps) {
  const { projects, loading: projectsLoading } = useProjects();
  const [form, setForm] = useState<AdminCreateUserFormValues>(emptyAdminCreateUserForm());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createdUserId, setCreatedUserId] = useState<string | null>(null);

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => a.name.localeCompare(b.name)),
    [projects],
  );

  const resetForm = () => {
    setForm(emptyAdminCreateUserForm());
    setErrors({});
    setShowPassword(false);
    setCreatedUserId(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetForm();
    }
    onOpenChange(nextOpen);
  };

  const handleSubmit = async () => {
    const parsed = adminCreateUserSchema.safeParse(form);
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]?.toString();
        if (key) nextErrors[key] = issue.message;
      }
      setErrors(nextErrors);
      return;
    }

    setBusy(true);
    setErrors({});
    try {
      const payload = {
        full_name: parsed.data.fullName,
        email: parsed.data.email,
        temporary_password: parsed.data.temporaryPassword,
        company_name: parsed.data.companyName?.trim() || null,
        job_title: parsed.data.jobTitle?.trim() || null,
        project_id: parsed.data.projectId?.trim() || null,
        project_role: parsed.data.projectRole ?? null,
      };
      const result = await onCreate(payload);
      setCreatedUserId(result.user_id);
      setForm(emptyAdminCreateUserForm());
      setShowPassword(false);
    } catch (err) {
      setErrors({
        submit: err instanceof Error ? err.message : "Failed to create user",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>
            Provision a new account with a temporary password. The user must change it at first
            login.
          </DialogDescription>
        </DialogHeader>

        {createdUserId ? (
          <div className="space-y-4 py-2">
            <p className="text-sm">
              User created successfully. They must change their temporary password at first login.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link to={`/admin/access/users/${createdUserId}`}>View user</Link>
              </Button>
              <Button
                onClick={() => {
                  resetForm();
                  onOpenChange(false);
                }}
              >
                Close
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="create-full-name">Full name</Label>
                <Input
                  id="create-full-name"
                  value={form.fullName}
                  onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))}
                  disabled={busy}
                />
                {errors.fullName ? (
                  <p className="text-xs text-destructive">{errors.fullName}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="create-email">Email</Label>
                <Input
                  id="create-email"
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                  disabled={busy}
                />
                {errors.email ? <p className="text-xs text-destructive">{errors.email}</p> : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="create-temp-password">Temporary password</Label>
                <div className="relative">
                  <Input
                    id="create-temp-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={form.temporaryPassword}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, temporaryPassword: event.target.value }))
                    }
                    disabled={busy}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1/2 h-7 -translate-y-1/2 px-2"
                    onClick={() => setShowPassword((prev) => !prev)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  The user will be required to change this password after their first login.
                </p>
                {errors.temporaryPassword ? (
                  <p className="text-xs text-destructive">{errors.temporaryPassword}</p>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="create-company">Company</Label>
                  <Input
                    id="create-company"
                    value={form.companyName ?? ""}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, companyName: event.target.value }))
                    }
                    disabled={busy}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="create-job-title">Job title</Label>
                  <Input
                    id="create-job-title"
                    value={form.jobTitle ?? ""}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, jobTitle: event.target.value }))
                    }
                    disabled={busy}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Initial project access (optional)</Label>
                <p className="text-xs text-muted-foreground">
                  Users without an initial project still receive standard product feature access and
                  can create their own project after login.
                </p>
                <Select
                  value={form.projectId || "__none__"}
                  onValueChange={(value) =>
                    setForm((prev) => ({
                      ...prev,
                      projectId: value === "__none__" ? "" : value,
                      projectRole: value === "__none__" ? undefined : prev.projectRole ?? "viewer",
                    }))
                  }
                  disabled={busy || projectsLoading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select project…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No project</SelectItem>
                    {sortedProjects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.projectId ? (
                  <div className="space-y-2 pt-1">
                    <Label htmlFor="create-project-role">Project role</Label>
                    <Select
                      value={form.projectRole ?? "viewer"}
                      onValueChange={(value) =>
                        setForm((prev) => ({
                          ...prev,
                          projectRole: value as ProjectRole,
                        }))
                      }
                      disabled={busy}
                    >
                      <SelectTrigger id="create-project-role">
                        <SelectValue placeholder="Role" />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSIGNABLE_INITIAL_PROJECT_ROLES.map((role) => (
                          <SelectItem key={role} value={role}>
                            {PROJECT_ROLE_LABELS[role]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                {errors.projectId ? (
                  <p className="text-xs text-destructive">{errors.projectId}</p>
                ) : null}
                {errors.projectRole ? (
                  <p className="text-xs text-destructive">{errors.projectRole}</p>
                ) : null}
              </div>

              {errors.submit ? <p className="text-sm text-destructive">{errors.submit}</p> : null}
            </div>

            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={() => void handleSubmit()}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create user
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
