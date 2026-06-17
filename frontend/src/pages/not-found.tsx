import { Link } from 'react-router-dom';
import { Home, SearchX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/** 404 占位 */
export default function NotFoundPage() {
  return (
    <div className="container flex flex-col items-center justify-center gap-6 py-16">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center justify-center">
            <SearchX className="h-10 w-10 text-muted-foreground" />
          </div>
          <CardTitle className="text-center text-2xl">404 · 页面不存在</CardTitle>
          <CardDescription className="text-center">
            抱歉,没有找到您访问的页面
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center pb-6">
          <Button asChild variant="default" className="gap-2">
            <Link to="/">
              <Home className="h-4 w-4" />
              返回首页
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
