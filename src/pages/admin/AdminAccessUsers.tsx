import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { Loader2, Plus, Search, Users } from "lucide-react";
import { AdminCreateUserDialog } from "@/components/admin/AdminCreateUserDialog";
import { AdminPageShell } from "@/components/admin/AdminPageShell";
import { AlertBanner, Panel } from "@/components/design/ProductPrimitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAdminApi } from "@/hooks/useAdminApi";
import { useToast } from "@/hooks/use-toast";
import type { AdminDirectoryUser } from "@/lib/adminApi";

const PAGE_SIZE = 25;

function displayName(user: AdminDirectoryUser): string {
  return (
    user.full_name?.trim() ||
    user.company_name?.trim() ||
    user.email?.trim() ||
    "Unnamed user"
  );
}

export default function AdminAccessUsers() {
  const adminApi = useAdminApi();
  const { toast } = useToast();
  const [users, setUsers] = useState<AdminDirectoryUser[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.listUsers({
        limit: PAGE_SIZE,
        offset,
        search: search || undefined,
      });
      setUsers(res.users);
      setTotal(res.pagination.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [adminApi, offset, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canPrev = offset > 0;
  const canNext = offset + PAGE_SIZE < total;

  return (
    <AdminPageShell
      variant="editorial"
      title="Authorization"
      description="Paginated platform user directory with access status and platform roles."
      breadcrumbs={[
        { label: "Authorization", href: "/admin/access/users" },
        { label: "Directory" },
      ]}
      actions={
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create user
        </Button>
      }
    >
      <div className="space-y-6">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setOffset(0);
            setSearch(searchInput.trim());
          }}
        >
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search name, company, or email…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
          {search ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSearchInput("");
                setSearch("");
                setOffset(0);
              }}
            >
              Clear
            </Button>
          ) : null}
        </form>

        {error ? <AlertBanner tone="bad" title="Could not load directory" detail={error} /> : null}

        <Panel title="Users" eyebrow={`${total} total`}>
          {loading ? (
            <div className="flex justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading users…
            </div>
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
              <Users className="h-10 w-10 opacity-50" />
              <p>No users match your filters.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Platform role</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user) => (
                      <TableRow key={user.user_id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{displayName(user)}</p>
                            {user.email &&
                            user.email !== displayName(user) ? (
                              <p className="text-xs text-muted-foreground">{user.email}</p>
                            ) : null}
                            <p className="text-xs text-muted-foreground font-mono">
                              {user.user_id.slice(0, 8)}…
                            </p>
                            {user.job_title ? (
                              <p className="text-xs text-muted-foreground">{user.job_title}</p>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              user.access_status === "active" ? "outline" : "destructive"
                            }
                            className="capitalize"
                          >
                            {user.access_status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {user.platform_admin ? (
                            <Badge>Platform admin</Badge>
                          ) : (
                            <Badge variant="outline" className="font-normal text-muted-foreground">
                              user
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {format(new Date(user.created_at), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild variant="link" size="sm">
                            <Link to={`/admin/access/users/${user.user_id}`}>View</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-4 flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Page {page} of {totalPages} · {total} users
                </p>
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        className={!canPrev ? "pointer-events-none opacity-50" : undefined}
                        onClick={(e) => {
                          e.preventDefault();
                          if (canPrev) setOffset(Math.max(0, offset - PAGE_SIZE));
                        }}
                      />
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        className={!canNext ? "pointer-events-none opacity-50" : undefined}
                        onClick={(e) => {
                          e.preventDefault();
                          if (canNext) setOffset(offset + PAGE_SIZE);
                        }}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            </>
          )}
        </Panel>
      </div>

      <AdminCreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={async (payload) => {
          const result = await adminApi.createUser(payload);
          toast({
            title: "User created",
            description: "They must change their temporary password at first login.",
          });
          setOffset(0);
          await load();
          return { user_id: result.user_id };
        }}
      />
    </AdminPageShell>
  );
}
